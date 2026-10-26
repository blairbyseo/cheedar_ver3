package com.cheddar.care;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import androidx.core.view.ViewCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Android 14 이하에서 키보드를 띄우면 앱 화면이 쪼그라들던 문제 (2026-10-26, Galaxy A9 Pro / Android 10).
        //
        // Capacitor 8 SystemBars 는 WebView 140+ 에서 키보드 높이만큼 WebView 부모에 아래 padding 을 준다
        // (SystemBars.java "shouldPassthroughInsets" 분기). 이건 창이 키보드 뒤까지 그려지는 Android 15+
        // (edge-to-edge) 를 위한 보정인데 버전을 가리지 않는다. Android 14 이하는 창이 edge-to-edge 가 아니라
        // OS 가 이미 키보드만큼 창을 줄이므로(adjustResize) 키보드 높이가 두 번 빠져 화면이 탭바만 남았다.
        //
        // 그래서 Android 14 이하에서만 Capacitor 의 insets 리스너를 바꿔 padding 을 걷어낸다.
        // 이 버전들은 시스템 바가 콘텐츠를 가리지 않아 safe-area 값이 원래 0 이므로 잃는 것이 없다.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            View webViewParent = (View) getBridge().getWebView().getParent();
            ViewCompat.setOnApplyWindowInsetsListener(webViewParent, (v, insets) -> {
                v.setPadding(0, 0, 0, 0);
                return insets;
            });
        }
    }
}
