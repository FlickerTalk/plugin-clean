import { initialize } from "@ionic/core/components";
import { defineCustomElement as button } from "@ionic/core/components/ion-button.js";
import { defineCustomElement as content } from "@ionic/core/components/ion-content.js";

initialize();
for (const define of [button, content]) define();
