(function () {
  function apiBase() {
    if (typeof window.__API_BASE__ === "string") {
      return window.__API_BASE__.replace(/\/$/, "");
    }
    var h = typeof location !== "undefined" ? location.hostname : "";
    if (h === "localhost" || h === "127.0.0.1") return "";
    return "/_/backend";
  }

  window.apiUrl = function apiUrl(path) {
    var p = path.charAt(0) === "/" ? path : "/" + path;
    return apiBase() + p;
  };
})();
