import { createApi } from "@justiniano/api";

export const api = createApi({
  storagePrefix: "jus_abogado",
  onAuthLost: () => { window.location.hash = "#/login"; },
});
