// The app lends Ionic to every plugin frame (app 1.6.0, 2026-10-09): `@ionic/core`'s custom
// elements are registered, with the app's mode, direction and colours, before the plugin's module
// runs. The view's tests do the same with the real `@ionic/core`, the version the app ships, so
// what the plugin draws here is what the phone draws. None of it goes into `dist/`.
import { initialize } from "@ionic/core/components";
import { defineCustomElement as button } from "@ionic/core/components/ion-button.js";
import { defineCustomElement as content } from "@ionic/core/components/ion-content.js";

initialize();
for (const define of [button, content]) define();
