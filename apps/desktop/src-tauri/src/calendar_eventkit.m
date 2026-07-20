#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>
#import <objc/message.h>
#import <objc/runtime.h>

// Clang emits this compiler-runtime query when weak-linking the macOS 14
// EventKit selector while the app still supports macOS 13. Rust links the final
// binary with -nodefaultlibs, so the Command Line Tools compiler runtime is not
// pulled in automatically. Keep the query local and truthful instead of raising
// Weekform's deployment target solely to satisfy the generated branch.
int wf_is_platform_version_at_least(uint32_t platform, uint32_t major, uint32_t minor, uint32_t patch)
    __asm__("___isPlatformVersionAtLeast");
int wf_is_platform_version_at_least(uint32_t platform, uint32_t major, uint32_t minor, uint32_t patch) {
    if (platform != 1) return 0; // 1 is macOS in Clang's availability ABI.
    NSOperatingSystemVersion requested = {
        .majorVersion = (NSInteger)major,
        .minorVersion = (NSInteger)minor,
        .patchVersion = (NSInteger)patch
    };
    return [[NSProcessInfo processInfo] isOperatingSystemAtLeastVersion:requested] ? 1 : 0;
}

static __attribute__((noinline)) SEL wf_full_access_selector(void) {
    const char name[] = {
        'r','e','q','u','e','s','t','F','u','l','l','A','c','c','e','s','s','T','o','E','v','e','n','t','s',
        'W','i','t','h','C','o','m','p','l','e','t','i','o','n',':','\0'
    };
    return sel_registerName(name);
}

static void wf_set_error(char **error_out, NSString *message) {
    if (error_out != NULL) *error_out = strdup(message.UTF8String ?: "Apple Calendar failed.");
}

char *weekform_eventkit_fetch(const char *start_iso, const char *end_iso, char **error_out) {
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];
        __block BOOL granted = NO;
        __block NSError *permission_error = nil;
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

        SEL fullAccessSelector = wf_full_access_selector();
        if ([store respondsToSelector:fullAccessSelector]) {
            typedef void (*WFRequestFullAccess)(id, SEL, void (^)(BOOL, NSError *));
            ((WFRequestFullAccess)objc_msgSend)(store, fullAccessSelector, ^(BOOL value, NSError *error) {
                granted = value;
                permission_error = error;
                dispatch_semaphore_signal(semaphore);
            });
        } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            [store requestAccessToEntityType:EKEntityTypeEvent completion:^(BOOL value, NSError *error) {
                granted = value;
                permission_error = error;
                dispatch_semaphore_signal(semaphore);
            }];
#pragma clang diagnostic pop
        }

        if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 120LL * NSEC_PER_SEC)) != 0) {
            wf_set_error(error_out, @"Apple Calendar permission timed out.");
            return NULL;
        }
        if (!granted) {
            wf_set_error(error_out, permission_error.localizedDescription ?: @"Apple Calendar access was not granted. Enable it in System Settings > Privacy & Security > Calendars.");
            return NULL;
        }

        NSISO8601DateFormatter *formatter = [[NSISO8601DateFormatter alloc] init];
        formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
        NSDate *start = [formatter dateFromString:[NSString stringWithUTF8String:start_iso]];
        NSDate *end = [formatter dateFromString:[NSString stringWithUTF8String:end_iso]];
        if (start == nil || end == nil || [end compare:start] != NSOrderedDescending) {
            wf_set_error(error_out, @"The Apple Calendar date range is invalid.");
            return NULL;
        }

        NSPredicate *predicate = [store predicateForEventsWithStartDate:start endDate:end calendars:nil];
        NSArray<EKEvent *> *events = [store eventsMatchingPredicate:predicate];
        NSMutableArray *result = [NSMutableArray arrayWithCapacity:events.count];
        for (EKEvent *event in events) {
            if (event.startDate == nil || event.endDate == nil) continue;
            NSString *identifier = event.eventIdentifier ?: event.calendarItemIdentifier;
            if (identifier.length == 0) continue;
            NSMutableDictionary *item = [@{
                @"provider_id": identifier,
                @"uid": event.calendarItemIdentifier ?: identifier,
                @"title": event.title ?: @"Untitled calendar event",
                @"start_time": [formatter stringFromDate:event.startDate],
                @"end_time": [formatter stringFromDate:event.endDate],
                @"attendee_count": @(event.attendees.count),
                @"all_day": @(event.allDay)
            } mutableCopy];
            item[@"location"] = event.location ?: [NSNull null];
            item[@"organizer"] = [NSNull null];
            [result addObject:item];
        }
        NSError *json_error = nil;
        NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:&json_error];
        if (data == nil) {
            wf_set_error(error_out, json_error.localizedDescription ?: @"Apple Calendar data could not be encoded.");
            return NULL;
        }
        NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        return strdup(json.UTF8String);
    }
}

void weekform_eventkit_free(char *value) {
    if (value != NULL) free(value);
}
