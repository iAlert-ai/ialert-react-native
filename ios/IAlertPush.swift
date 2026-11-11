import BackgroundTasks
import Foundation
import ObjectiveC
import React
import UIKit
import UserNotifications

/// Native side of ialert-react-native on iOS. Set up at launch (no AppDelegate
/// code): APNs token by swizzling the app delegate, a forwarding notification
/// center delegate for foreground display and taps, and the background Inbox
/// sync that shows messages as local notifications while APNs is unreachable.
@objc(IAlertPushSetup)
public final class IAlertPushSetup: NSObject, UNUserNotificationCenterDelegate {
    @objc public static let shared = IAlertPushSetup()

    static let defaults = UserDefaults.standard
    static let registrationKey = "ialert.native.registration"
    static let shownKey = "ialert.native.shown"

    private weak var previousDelegate: UNUserNotificationCenterDelegate?
    private(set) var token: String?
    var initialOpen: [String: Any]?
    weak var module: IAlertPush?
    private var installed = false

    /// Called from `+load` through the launch notification.
    @objc public func install() {
        guard !installed else { return }
        installed = true

        let center = UNUserNotificationCenter.current()
        if let current = center.delegate, current !== self {
            previousDelegate = current
        }
        center.delegate = self
        swizzleTokenCallback()

        if Self.backgroundSyncAllowed {
            BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.syncIdentifier, using: nil) { task in
                Self.scheduleBackgroundSync()
                let work = Task {
                    await Self.backgroundSync()
                    task.setTaskCompleted(success: true)
                }
                task.expirationHandler = { work.cancel() }
            }
            NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
                Self.scheduleBackgroundSync()
            }
        }
    }

    func didReceive(token deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        token = hex
        module?.emit("onToken", hex)
    }

    private static let tokenSelector = #selector(UIApplicationDelegate.application(_:didRegisterForRemoteNotificationsWithDeviceToken:))

    private func swizzleTokenCallback() {
        guard let delegate = UIApplication.shared.delegate, let cls = object_getClass(delegate) else { return }
        typealias TokenIMP = @convention(c) (AnyObject, Selector, UIApplication, Data) -> Void
        let selector = Self.tokenSelector
        let original = class_getInstanceMethod(cls, selector).map { unsafeBitCast(method_getImplementation($0), to: TokenIMP.self) }
        let block: @convention(block) (AnyObject, UIApplication, Data) -> Void = { object, application, deviceToken in
            original?(object, selector, application, deviceToken)
            IAlertPushSetup.shared.didReceive(token: deviceToken)
        }
        let implementation = imp_implementationWithBlock(block)
        if let method = class_getInstanceMethod(cls, selector), original != nil {
            method_setImplementation(method, implementation)
        } else {
            class_addMethod(cls, selector, implementation, "v@:@@")
        }
    }

    // MARK: Notification center (forwarded to the app's previous delegate)

    private static func isIAlert(_ notification: UNNotification) -> Bool {
        notification.request.content.userInfo["ialert"] != nil
    }

    static func payload(_ notification: UNNotification) -> [String: Any] {
        let content = notification.request.content
        return ["userInfo": sanitize(content.userInfo), "title": content.title, "body": content.body]
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if Self.isIAlert(notification) {
            module?.emit("onPush", Self.payload(notification))
        }
        if let previousDelegate, previousDelegate.responds(to: #selector(userNotificationCenter(_:willPresent:withCompletionHandler:))) {
            previousDelegate.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
            return
        }
        completionHandler(Self.isIAlert(notification) ? [.banner, .list, .sound] : [])
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let notification = response.notification
        if Self.isIAlert(notification) {
            let payload = Self.payload(notification)
            if module?.emit("onOpen", payload) != true {
                initialOpen = payload // read by JS after a cold start
            }
            Self.openURL(notification.request.content.userInfo)
        }
        if let previousDelegate, previousDelegate.responds(to: #selector(userNotificationCenter(_:didReceive:withCompletionHandler:))) {
            previousDelegate.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
            return
        }
        completionHandler()
    }

    private static func openURL(_ userInfo: [AnyHashable: Any]) {
        let data = (userInfo["ialert"] as? [String: Any])?["data"] as? [String: Any]
        guard let string = data?["url"] as? String, let url = URL(string: string) else { return }
        DispatchQueue.main.async { UIApplication.shared.open(url) }
    }

    private static func sanitize(_ value: Any) -> Any {
        switch value {
        case let dict as [AnyHashable: Any]:
            var out: [String: Any] = [:]
            for (key, item) in dict { if let key = key as? String { out[key] = sanitize(item) } }
            return out
        case let array as [Any]:
            return array.map(sanitize)
        case is String, is NSNumber, is NSNull:
            return value
        default:
            return "\(value)"
        }
    }

    // MARK: Background Inbox sync (internet shutdown)

    static var syncIdentifier: String { "\(Bundle.main.bundleIdentifier ?? "app").ialert-sync" }

    /// `BGTaskScheduler.register` crashes for identifiers missing from Info.plist.
    static var backgroundSyncAllowed: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String] ?? []).contains(syncIdentifier)
    }

    static func scheduleBackgroundSync() {
        let request = BGAppRefreshTaskRequest(identifier: syncIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Pull unread Inbox entries that no channel delivered and show them as local notifications.
    static func backgroundSync() async {
        guard let registration = defaults.dictionary(forKey: registrationKey),
              let apiUrl = registration["apiUrl"] as? String,
              let deviceId = registration["deviceId"] as? String,
              let deviceToken = registration["deviceToken"] as? String,
              let id = deviceId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let url = URL(string: "\(apiUrl)/devices/\(id)/inbox?per_page=100&unread=1") else { return }

        let bearer = (registration["publicKey"] as? String).map { "Bearer \($0)" }
        var request = URLRequest(url: url)
        request.setValue(bearer, forHTTPHeaderField: "Authorization")
        request.setValue(deviceToken, forHTTPHeaderField: "X-Device-Token")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        guard let (body, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let entries = json["data"] as? [[String: Any]] else { return }

        let center = UNUserNotificationCenter.current()
        let showing = Set(await center.deliveredNotifications().compactMap { ($0.request.content.userInfo["ialert"] as? [String: Any])?["id"] as? String })
        var shown = defaults.stringArray(forKey: shownKey) ?? []
        var delivered: [String] = []

        for entry in entries.reversed() {
            guard let entryId = entry["id"] as? String, entry["delivered_at"] is NSNull || entry["delivered_at"] == nil else { continue }
            delivered.append(entryId)
            guard !showing.contains(entryId), !shown.contains(entryId) else { continue }

            let message = entry["content"] as? [String: Any] ?? [:]
            let title = message["title"] as? String
            let text = message["body"] as? String
            guard title != nil || text != nil else { continue }

            let content = UNMutableNotificationContent()
            content.title = title ?? ""
            content.body = text ?? ""
            content.sound = .default
            var ialert: [String: Any] = ["id": entryId]
            ialert["data"] = message["data"] as? [String: Any]
            ialert["image"] = message["image"] as? String
            content.userInfo = ["ialert": ialert]
            try? await center.add(UNNotificationRequest(identifier: "ialert-\(entryId)", content: content, trigger: nil))
            shown.append(entryId)
        }

        defaults.set(Array(shown.suffix(500)), forKey: shownKey)

        if !delivered.isEmpty, let ackURL = URL(string: "\(apiUrl)/devices/\(id)/inbox/ack") {
            var ack = URLRequest(url: ackURL)
            ack.httpMethod = "POST"
            ack.setValue(bearer, forHTTPHeaderField: "Authorization")
            ack.setValue(deviceToken, forHTTPHeaderField: "X-Device-Token")
            ack.setValue("application/json", forHTTPHeaderField: "Content-Type")
            ack.setValue("application/json", forHTTPHeaderField: "Accept")
            ack.httpBody = try? JSONSerialization.data(withJSONObject: ["ids": Array(delivered.prefix(100)), "event": "delivered"])
            _ = try? await URLSession.shared.data(for: ack)
        }
    }
}

/// The JS module `NativeModules.IAlertPush`.
@objc(IAlertPush)
public final class IAlertPush: RCTEventEmitter {
    private var hasListeners = false

    public override init() {
        super.init()
        IAlertPushSetup.shared.module = self
    }

    @objc public override static func requiresMainQueueSetup() -> Bool { false }
    public override func supportedEvents() -> [String]! { ["onToken", "onPush", "onOpen"] }
    public override func startObserving() { hasListeners = true }
    public override func stopObserving() { hasListeners = false }

    @discardableResult
    func emit(_ name: String, _ body: Any) -> Bool {
        guard hasListeners else { return false }
        sendEvent(withName: name, body: body)
        return true
    }

    @objc(requestPermission:rejecter:)
    func requestPermission(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
                resolve(granted)
            }
        }
    }

    @objc(getToken:rejecter:)
    func getToken(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        resolve(IAlertPushSetup.shared.token)
    }

    @objc(takeInitialOpen:rejecter:)
    func takeInitialOpen(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        resolve(IAlertPushSetup.shared.initialOpen)
        IAlertPushSetup.shared.initialOpen = nil
    }

    @objc(setRegistration:)
    func setRegistration(_ registration: NSDictionary) {
        IAlertPushSetup.defaults.set(registration as? [String: Any], forKey: IAlertPushSetup.registrationKey)
    }
}
