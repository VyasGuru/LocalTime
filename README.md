# LocalTime

LocalTime is an unofficial Chrome extension that adds the other participant's local time to the header of a one-to-one LinkedIn conversation. It reads the participant's profile link, fetches that LinkedIn profile page using your existing signed-in session, extracts the displayed location, and resolves it to a time zone. You can click the time pill to enter a city or IANA time zone manually.

> [!WARNING]
> LocalTime is not affiliated with, endorsed by, or produced by LinkedIn. LinkedIn says it does not permit browser extensions that scrape data, modify the appearance of its website, or automate activity. This extension modifies LinkedIn's messaging page and fetches profile pages, so using it may violate LinkedIn's User Agreement and may put your account at risk of restriction. A profile fetch may also count as a profile view; LinkedIn does not document whether this type of background request is recorded as one. Use it at your own risk.

- [LinkedIn: Prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions)
- [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement)

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `local-time` directory.
5. Open or refresh `https://www.linkedin.com/messaging/`.

After changing the source, click **Reload** for LocalTime on `chrome://extensions`, then refresh the LinkedIn tab. Reloading the extension does not reinject it into an already-open page.

## How it works

- On an uncached one-to-one conversation, LocalTime automatically requests the participant's LinkedIn profile page and looks for the displayed location.
- Cached and manually entered locations render without another profile request.
- Clicking the pill lets you enter a city, region, country, or valid IANA time-zone name such as `Asia/Tokyo`.
- Multi-zone countries show an illustrative range when no city or region is known. Brazil and Mexico use an explicitly marked approximate default.
- Headers that cannot be resolved to one profile are skipped.

Current request safeguards are:

- Duplicate lookups for the same profile are coalesced
- A 10-second request timeout
- Cancellation when you switch conversations, close or leave the relevant messaging surface, or hide the tab
- A one-hour global pause after HTTP 403, HTTP 429, or an authentication redirect
- Successful results cached for 30 days and unsuccessful lookups, including transient failures, cached for 24 hours
- A maximum of 500 automatic cache entries; manual overrides are not included in this limit

There is currently no global one-at-a-time queue, daily lookup cap, or minimum delay between successful requests. Different visible uncached conversations can be requested concurrently. Moving rapidly through conversations can initiate multiple profile requests even when some are subsequently cancelled.

## Privacy

LocalTime has no analytics, telemetry, remote code, or developer-operated server.

- LocalTime's explicit profile requests target only `www.linkedin.com`. Parsing returned HTML may cause Chrome to request subresources referenced by that LinkedIn markup; LocalTime does not intentionally contact a developer-operated or third-party endpoint.
- Requests use your existing LinkedIn session because the profile location may not be visible while signed out. LocalTime does not read or store cookies, but Chrome sends applicable LinkedIn cookies to LinkedIn with these authenticated requests.
- Profile identifiers, extracted location strings, manual overrides, expiry times, and the lookup cooldown are stored in `chrome.storage.local` in your browser. Manual overrides remain until replaced, the extension data is cleared, or the extension is uninstalled.
- Message contents and CSRF tokens are not read, stored, or transmitted by LocalTime.
- Stored data is not synchronized to the developer or intentionally sent to third parties.

Removing the extension removes its access to the stored data. Chrome may retain extension storage until the extension is uninstalled or its site data is cleared.

## Limitations

- LinkedIn can change its page structure at any time, which may stop header or location detection from working.
- Conversation and participant detection is heuristic. Group, self, deleted, blocked, company, and system conversations are intended to be skipped, but a LinkedIn markup change can cause a missing or incorrectly associated pill.
- LinkedIn profiles can contain missing, broad, ambiguous, or non-English locations. Split-region and same-name locations can also resolve to an approximate or incorrect zone. Use the manual override when the inferred time zone is not accurate.
- Country-level ranges use illustrative endpoints and can omit outlying or intermediate time zones.
- Time-zone and daylight-saving rules come from Chrome's built-in `Intl` data, so recently changed rules require an up-to-date browser.
- Whether an automatic profile request appears in LinkedIn's profile-view history is unknown.
- The extension supports Chrome Manifest V3. Its content script loads in matching frames on LinkedIn pages so it can detect SPA navigation and floating message windows, but lookup and rendering logic activates only for a visible messaging conversation.

## Reporting issues

Open an issue in this repository with the LocalTime version, Chrome version, and a description of what happened. Do not attach saved LinkedIn pages, raw HTML, screenshots containing conversations, profile URLs or IDs, cookies, request headers, or other personal data. Use invented names and synthetic markup for reproducible examples.

## Development

There is no build step. The unpacked extension is the `local-time` directory. After editing it, reload the extension and refresh LinkedIn.

## License

LocalTime is available under the [MIT License](LICENSE).
