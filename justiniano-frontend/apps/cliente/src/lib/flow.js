/**
 * Estado efímero del flujo de registro (signup → verificar correo →
 * verificar teléfono → onboarding). El correo y el teléfono se respaldan en
 * sessionStorage para sobrevivir recargas; la contraseña solo vive en memoria
 * (si se pierde, el usuario continúa por /login).
 */
const K_EMAIL = "jus_flow_email";
const K_PHONE = "jus_flow_phone";

let password = "";

export const signupFlow = {
  get email() { return sessionStorage.getItem(K_EMAIL) || ""; },
  set email(v) { sessionStorage.setItem(K_EMAIL, v || ""); },
  get phone() { return sessionStorage.getItem(K_PHONE) || ""; },
  set phone(v) { sessionStorage.setItem(K_PHONE, v || ""); },
  get password() { return password; },
  set password(v) { password = v || ""; },
  clear() {
    sessionStorage.removeItem(K_EMAIL);
    sessionStorage.removeItem(K_PHONE);
    password = "";
  },
};
