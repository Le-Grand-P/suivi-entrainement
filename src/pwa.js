// Enregistrement du service worker : c'est lui qui met en cache les fichiers
// de l'appli pour qu'elle continue de fonctionner sans connexion, et qui
// permet l'installation sur l'écran d'accueil Android.

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((err) => {
      console.warn("Service worker non enregistré :", err);
    });
  });
}

/**
 * Affiche le bandeau "Installer l'appli" quand Chrome/Android propose
 * l'installation (événement beforeinstallprompt — Chrome/Edge Android
 * uniquement ; Safari iOS n'a pas d'équivalent, le bandeau reste alors
 * masqué et l'utilisateur passe par "Partager > Sur l'écran d'accueil").
 */
export function setupInstallPrompt() {
  const banner = document.getElementById("install-banner");
  const btn = document.getElementById("btn-install");
  if (!banner || !btn) return;

  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    deferredPrompt = ev;
    // Ne réaffiche pas le bandeau si l'utilisateur l'a déjà refusé cette session.
    if (sessionStorage.getItem("installBannerDismissed") !== "1") {
      banner.classList.add("show");
    }
  });

  btn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    banner.classList.remove("show");
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });

  window.addEventListener("appinstalled", () => {
    banner.classList.remove("show");
    sessionStorage.setItem("installBannerDismissed", "1");
  });
}
