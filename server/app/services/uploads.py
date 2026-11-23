"""식단 사진 업로드 서비스.

업로드 흐름:
1. 검증 (content-type, 용량)
2. 사진 속 메타데이터(EXIF: 위치·기기 정보 등) 제거 — 공개 URL 로 새어 나가지 않게
3. boto3 로 S3 버킷에 PUT (Key: meals/{uuid}.{ext})
4. (abs_path, public_url) 반환
   - abs_path: 로컬 임시 파일 경로. OpenAI 분석을 base64 로 보내는 데 사용.
   - public_url: 프론트가 <img src=...> 로 쓸 공개 URL.

S3 자격증명은 boto3 기본 chain 으로 탐색:
  1) settings.aws_access_key_id / secret_access_key (.env)
  2) ~/.aws/credentials (aws configure 로 만든 파일)
  3) EC2/ECS IAM Role
"""

import io
import uuid
from pathlib import Path

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps

from app.core.config import get_settings

settings = get_settings()

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
EXTENSION_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
PIL_FORMAT_BY_MIME = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}


def strip_image_metadata(contents: bytes, content_type: str) -> bytes:
    """사진에서 메타데이터(EXIF 위치·촬영 기기 등)를 떼어낸 새 파일 바이트를 돌려준다.

    식단 사진은 공개 읽기 버킷에 올라가므로, 원본에 GPS 좌표가 남아 있으면
    URL 을 아는 누구나 볼 수 있다. 그래서 올리기 전에 픽셀만 남기고 다시 저장한다.

    - 회전 정보(EXIF Orientation)는 지우기 전에 픽셀에 먼저 반영한다.
      안 그러면 세로로 찍은 사진이 옆으로 누워 보인다.
    - 색 프로필(ICC)은 개인정보가 아니고 색감에 필요하므로 유지한다.
    - 읽을 수 없는 파일은 400 — 메타데이터를 못 지운 원본을 그대로 올리지 않는다.
    """
    try:
        with Image.open(io.BytesIO(contents)) as img:
            img = ImageOps.exif_transpose(img)
            icc = img.info.get("icc_profile")
            fmt = PIL_FORMAT_BY_MIME[content_type]
            if fmt == "JPEG" and img.mode not in ("RGB", "L", "CMYK"):
                img = img.convert("RGB")
            # 새 이미지로 옮겨 담아 원본의 부가 정보(info)가 따라오지 않게 한다.
            clean = Image.new(img.mode, img.size)
            clean.paste(img)
            if img.mode == "P":
                clean.putpalette(img.getpalette())
            save_kwargs: dict = {"icc_profile": icc} if icc else {}
            if fmt == "JPEG":
                save_kwargs.update(quality=92, optimize=True)
            elif fmt == "WEBP":
                save_kwargs.update(quality=92)
            out = io.BytesIO()
            clean.save(out, format=fmt, **save_kwargs)
            return out.getvalue()
    except HTTPException:
        raise
    except Exception as exc:  # Pillow 는 손상 파일에 여러 종류의 예외를 던진다
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "이미지를 읽을 수 없어요. 다른 사진으로 다시 시도해주세요.",
        ) from exc


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

    # 위치 등 메타데이터를 지운 사본만 S3·로컬·OpenAI 로 보낸다.
    contents = strip_image_metadata(contents, file.content_type)

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


def delete_meal_image(public_url: str | None) -> None:
    """식단 사진(S3 객체 + 로컬 임시 파일)을 삭제한다 (best-effort).

    회원탈퇴 익명화에서 쓴다. 영양 수치는 연구용으로 남기지만 사진은
    본인·주변이 찍힐 수 있어 파일 자체를 지운다.

    save_meal_image 가 만든 URL 형식만 처리한다:
      https://{bucket}.s3.{region}.amazonaws.com/meals/{filename}
    형식이 다르거나(레거시 이관분 등) 삭제에 실패해도 조용히 넘어간다 —
    탈퇴 처리 자체를 실패시키지 않는 게 우선이다.
    """
    prefix = f"https://{settings.s3_bucket}.s3.{settings.aws_region}.amazonaws.com/"
    if not public_url or not public_url.startswith(prefix):
        return

    s3_key = public_url[len(prefix) :]
    try:
        _s3_client().delete_object(Bucket=settings.s3_bucket, Key=s3_key)
    except (BotoCoreError, ClientError):
        pass

    # 분석용으로 떨어뜨렸던 로컬 임시 파일도 함께 정리
    try:
        (Path(settings.upload_dir) / s3_key).unlink(missing_ok=True)
    except OSError:
        pass


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
