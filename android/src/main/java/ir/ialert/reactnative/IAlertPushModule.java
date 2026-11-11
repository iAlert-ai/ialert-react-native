package ir.ialert.reactnative;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.util.Map;

import ir.ialert.sdk.IAlertBridge;
import kotlin.Unit;

/**
 * Android side of ialert-react-native, on the iAlert Android SDK: the FCM token (iAlert's
 * shared Firebase project unless the app uploaded its own service account, so no Firebase
 * setup), notification channels and display, taps (opening {@code data.url}), and the
 * WorkManager sync that shows Inbox messages while FCM is unreachable. The JS client
 * registers the device and runs the Gateway.
 */
public class IAlertPushModule extends ReactContextBaseJavaModule implements IAlertBridge.Events {
    private final ReactApplicationContext context;

    IAlertPushModule(ReactApplicationContext context) {
        super(context);
        this.context = context;
        IAlertBridge.attach(context, this);
    }

    @Override
    public String getName() {
        return "IAlertPush";
    }

    @Override
    public void invalidate() {
        IAlertBridge.detach();
        super.invalidate();
    }

    @ReactMethod
    public void requestPermission(Promise promise) {
        promise.resolve(IAlertBridge.requestPermission());
    }

    @ReactMethod
    public void getToken(ReadableMap config, Promise promise) {
        String publicKey = config != null && config.hasKey("publicKey") ? config.getString("publicKey") : null;
        String apiUrl = config != null && config.hasKey("apiUrl") ? config.getString("apiUrl") : null;
        if (publicKey == null || apiUrl == null) {
            promise.resolve(null);
            return;
        }
        IAlertBridge.token(context, publicKey, apiUrl, token -> {
            promise.resolve(token);
            return Unit.INSTANCE;
        });
    }

    @ReactMethod
    public void takeInitialOpen(Promise promise) {
        Map<String, String> open = IAlertBridge.takeInitialOpen();
        promise.resolve(open == null ? null : payload(open, null, null));
    }

    @ReactMethod
    public void setRegistration(ReadableMap registration) {
        if (registration == null) {
            return;
        }
        String publicKey = registration.hasKey("publicKey") ? registration.getString("publicKey") : null;
        String apiUrl = registration.hasKey("apiUrl") ? registration.getString("apiUrl") : null;
        String deviceId = registration.hasKey("deviceId") ? registration.getString("deviceId") : null;
        String deviceToken = registration.hasKey("deviceToken") ? registration.getString("deviceToken") : null;
        if (publicKey != null && apiUrl != null && deviceId != null && deviceToken != null) {
            IAlertBridge.setRegistration(context, publicKey, apiUrl, deviceId, deviceToken);
        }
    }

    @ReactMethod
    public void addListener(String eventName) {
    }

    @ReactMethod
    public void removeListeners(double count) {
    }

    @Override
    public void onToken(String token) {
        emit("onToken", token);
    }

    @Override
    public void onPush(Map<String, String> data, String title, String body) {
        emit("onPush", payload(data, title, body));
    }

    @Override
    public void onOpen(Map<String, String> data) {
        emit("onOpen", payload(data, null, null));
    }

    private static WritableMap payload(Map<String, String> data, String title, String body) {
        WritableMap userInfo = Arguments.createMap();
        for (Map.Entry<String, String> entry : data.entrySet()) {
            userInfo.putString(entry.getKey(), entry.getValue());
        }
        WritableMap payload = Arguments.createMap();
        payload.putMap("userInfo", userInfo);
        payload.putString("title", title);
        payload.putString("body", body);
        return payload;
    }

    private void emit(String event, Object value) {
        if (context.hasActiveReactInstance()) {
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(event, value);
        }
    }
}
