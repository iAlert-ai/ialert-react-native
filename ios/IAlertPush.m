#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <UIKit/UIKit.h>

@interface IAlertPushSetup : NSObject
+ (IAlertPushSetup *)shared;
- (void)install;
@end

@interface RCT_EXTERN_MODULE(IAlertPush, RCTEventEmitter)
RCT_EXTERN_METHOD(requestPermission:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getToken:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(takeInitialOpen:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(setRegistration:(NSDictionary *)registration)
@end

/// Sets iAlert up at launch, before the app delegate returns, so the APNs token,
/// cold-start taps and the background task registration need no app code.
@interface IAlertPushLauncher : NSObject
@end

@implementation IAlertPushLauncher
+ (void)load {
    [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidFinishLaunchingNotification
                                                      object:nil
                                                       queue:nil
                                                  usingBlock:^(NSNotification *note) {
        [[NSClassFromString(@"IAlertPushSetup") performSelector:@selector(shared)] install];
    }];
}
@end
