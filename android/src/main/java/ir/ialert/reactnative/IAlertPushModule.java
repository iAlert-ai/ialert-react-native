package ir.ialert.reactnative;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;

/**
 * Android side of ialert-react-native. Native FCM (through iAlert's own Firebase
 * project), notification display and the background Inbox sync come with the
 * Android SDK work; until then the app receives messages over the Gateway and
 * Inbox, and getToken resolves null.
 */
public class IAlertPushModule extends ReactContextBaseJavaModule {
    IAlertPushModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return "IAlertPush";
    }

    @ReactMethod
    public void requestPermission(Promise promise) {
        promise.resolve(false);
    }

    @ReactMethod
    public void getToken(Promise promise) {
        promise.resolve(null);
    }

    @ReactMethod
    public void takeInitialOpen(Promise promise) {
        promise.resolve(null);
    }

    @ReactMethod
    public void setRegistration(ReadableMap registration) {
    }

    @ReactMethod
    public void addListener(String eventName) {
    }

    @ReactMethod
    public void removeListeners(double count) {
    }
}
