import AuthenticationServices
import Capacitor
import CryptoKit

/// Sign in with Apple 브리지 (App Store 4.8).
///
/// 커뮤니티 플러그인(@capacitor-community/apple-sign-in)은 Capacitor 7 까지만
/// 지원해 SPM 의존성이 충돌하므로 앱 안에 직접 둔다. MainViewController 가 등록한다.
///
/// JS: `AppleSignIn.authorize({ nonce })` →
///     `{ identityToken, authorizationCode, givenName, familyName }`
/// nonce 는 원본을 받아 SHA-256 해시만 Apple 에 넘긴다. 서버가 원본과 토큰의 해시를 비교한다.
@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleSignInPlugin"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?

    @objc func authorize(_ call: CAPPluginCall) {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        // 이메일은 요청하지 않는다 — 앱 기능에 필요 없다(데이터 최소 수집).
        request.requestedScopes = [.fullName]
        if let nonce = call.getString("nonce") {
            let digest = SHA256.hash(data: Data(nonce.utf8))
            request.nonce = digest.map { String(format: "%02x", $0) }.joined()
        }

        pendingCall = call
        DispatchQueue.main.async {
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }
}

extension AppleSignInPlugin: ASAuthorizationControllerDelegate {
    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let call = pendingCall else { return }
        pendingCall = nil

        guard
            let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let tokenData = credential.identityToken,
            let identityToken = String(data: tokenData, encoding: .utf8)
        else {
            call.reject("Apple 로그인 정보를 받지 못했어요.")
            return
        }

        var result: [String: Any] = ["identityToken": identityToken]
        if let codeData = credential.authorizationCode,
           let code = String(data: codeData, encoding: .utf8) {
            result["authorizationCode"] = code
        }
        // 이름은 Apple 이 '처음 로그인할 때'만 준다.
        if let given = credential.fullName?.givenName { result["givenName"] = given }
        if let family = credential.fullName?.familyName { result["familyName"] = family }
        call.resolve(result)
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        let canceled = (error as? ASAuthorizationError)?.code == .canceled
        // 사용자가 직접 닫은 경우는 JS 에서 조용히 무시할 수 있게 코드를 구분한다.
        call.reject(error.localizedDescription, canceled ? "CANCELED" : "FAILED", error)
    }
}

extension AppleSignInPlugin: ASAuthorizationControllerPresentationContextProviding {
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        bridge?.webView?.window ?? ASPresentationAnchor()
    }
}

/// 앱 안에 둔 플러그인을 Capacitor 에 등록하는 루트 뷰컨트롤러.
/// Main.storyboard 의 customClass 가 이 클래스를 가리킨다.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppleSignInPlugin())
    }
}
