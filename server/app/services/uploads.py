"""식단 사진 업로드 서비스.

업로드 흐름:
1. 검증 (content-type, 용량)
2. boto3 로 S3 버킷에 PUT (Key: meals/{uuid}.{ext})
3. (abs_path, public_url) 반환
   - abs_path: 로컬 임시 파일 경로. OpenAI 분석을 base64 로 보내는 데 사용.
   - public_url: 프론트가 <img src=...> 로 쓸 공개 URL.

S3 자격증명은 boto3 기본 chain 으로 탐색:
  1) settings.aws_access_key_id / secret_access_key (.env)
  2) ~/.aws/credentials (aws configure 로 만든 파일)
  3) EC2/ECS IAM Role
"""

import uuid
from pathlib import Path

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException, UploadFile, status

from app.core.config import get_settings

settings = get_settings()

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
EXTENSION_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def _s3_client():
    """현재 .env / aws configure 자격증명으로 S3 client 생성.
    매 호출마다 새로 만들어도 boto3 가 내부적으로 캐싱하므로 성능 부담 없음."""
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,        # None 이면 boto3 가 ~/.aws/credentials 자동 사용
        aws_secret_access_key=settings.aws_secret_access_key,
    )


def save_meal_image(file: UploadFile) -> tuple[Path, str]:
    """업로드된 식단 사진을 S3 에 저장하고 (로컬 임시 경로, 공개 URL) 반환.

    OpenAI 분석을 base64 로 처리해야 해서 로컬에도 잠시 떨어뜨림.
    """
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Unsupported image type: {file.content_type}",
        )

    contents = file.file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Image exceeds {settings.max_upload_mb}MB",
        )

    suffix = EXTENSION_BY_MIME[file.content_type]
    filename = f"{uuid.uuid4().hex}{suffix}"
    s3_key = f"meals/{filename}"

    # 1) S3 업로드
    try:
        _s3_client().put_object(
            Bucket=settings.s3_bucket,
            Key=s3_key,
            Body=contents,
            ContentType=file.content_type,
            # 별도로 ACL 안 줌. 버킷 정책으로 GetObject 가 이미 퍼블릭.
        )
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"S3 upload failed: {exc}",
        ) from exc

    # 2) OpenAI 분석을 위해 로컬에도 임시 보관
    local_dir = Path(settings.upload_dir) / "meals"
    local_dir.mkdir(parents=True, exist_ok=True)
    abs_path = local_dir / filename
    abs_path.write_bytes(contents)

    # 3) 프론트에 줄 공개 URL (Virtual-hosted-style)
    public_url = (
        f"https://{settings.s3_bucket}.s3.{settings.aws_region}.amazonaws.com/{s3_key}"
    )
    return abs_path, public_url


def save_profile_image(file: UploadFile) -> str:
    """업로드된 프로필 사진을 로컬 uploads/profiles/ 에 저장하고 공개 경로를 반환.

    프로필 사진은 S3 없이 백엔드가 직접 서빙한다(main.py 의 /uploads 정적 마운트).
    반환 예: '/uploads/profiles/ab12cd34.jpg'
    """
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "이미지는 JPG, PNG, WebP 형식만 올릴 수 있어요.",
        )

    contents = file.file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"이미지 용량은 {settings.max_upload_mb}MB 이하여야 해요.",
        )

    suffix = EXTENSION_BY_MIME[file.content_type]
    filename = f"{uuid.uuid4().hex}{suffix}"

    profiles_dir = Path(settings.upload_dir) / "profiles"
    profiles_dir.mkdir(parents=True, exist_ok=True)
    (profiles_dir / filename).write_bytes(contents)

    return f"/uploads/profiles/{filename}"


def delete_profile_image(public_path: str | None) -> None:
    """이전 프로필 사진 파일을 삭제한다 (best-effort).

    로컬 업로드 파일('/uploads/profiles/...')만 지운다. 카카오 URL('http...')이나
    None 은 우리 파일이 아니므로 건너뛴다. 파일이 이미 없거나 삭제에 실패해도
    조용히 넘어간다 — 새 사진 저장은 이미 끝난 뒤라 치명적이지 않다.
    """
    if not public_path or not public_path.startswith("/uploads/profiles/"):
        return
    filename = public_path.rsplit("/", 1)[-1]
    try:
        (Path(settings.upload_dir) / "profiles" / filename).unlink(missing_ok=True)
    except OSError:
        pass
