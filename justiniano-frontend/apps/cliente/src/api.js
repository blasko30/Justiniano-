import { createApi } from "@justiniano/api";

export const api = createApi({
  storagePrefix: "jus_cliente",
  onAuthLost: () => { window.location.hash = "#/login"; },
});
