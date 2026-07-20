#import <AppKit/AppKit.h>

void weekform_activate_app(void) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSRunningApplication *currentApplication =
        [NSRunningApplication currentApplication];
    [currentApplication unhide];
    [currentApplication activateWithOptions:NSApplicationActivateAllWindows];
    [NSApp activate];
  });
}
