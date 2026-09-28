import { createApi } from "@justiniano/api";

export const api = createApi({
  storagePrefix: "jus_admin",
  onAuthLost: () => { window.location.hash = "#/login"; },
});
