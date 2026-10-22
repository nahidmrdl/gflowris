# Chrome extension

The extension is the ongoing connection between gflowris and your signed-in Flow project. It remains installed while you use the desktop app.

## Install and connect

The desktop download includes `extension/`. **Extension setup** opens that folder. In `chrome://extensions`, enable Developer mode and load it unpacked. Open a Flow project, then choose **Connect this project** in **gflowris bridge**.

The separate **chrome-extension.zip** release contains the same bridge. Extract it before loading. Both release copies have a fixed public manifest key and ID; the desktop automatically registers that origin. Source installs register their own development ID using `setup-native.ps1`.

The app links directly to its bundled folder. There is no Chrome Web Store listing yet, and no previous release is needed to establish the connection.

## Permissions

| Permission | Purpose |
| --- | --- |
| `nativeMessaging` | Exchange commands and results with the registered desktop host. |
| `storage` | Remember the selected project and connection preferences. |
| `downloads` | Match completed downloads to the active queue item. |
| `debugger` | Send the trusted Generate interaction to the paired project. This permission can technically inspect/control tabs; gflowris restricts its use to the selected Flow action. Chrome may show its debugging banner. |
| Flow host access | Read controls, apply settings, enter prompts, observe generation, and request downloads. |
| `127.0.0.1` host access | Support the authenticated local bridge, including the prototype transport. |

Google credentials remain in Chrome. The extension validates the current paired project and checks cancellation before the next operation. It does not bypass Google account requirements or usage limits.

## Updates

After updating files, reload the extension in `chrome://extensions`, reload Flow, and reconnect. Keep the connected project open and allow multiple downloads if Chrome asks.

Native host compatibility name: `com.automationflowgen.bridge`. This identifier is retained for existing installations; the visible name is gflowris.
