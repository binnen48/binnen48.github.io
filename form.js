(function () {
  var form = document.getElementById("intake");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var get = function (name) {
      var el = form.elements[name];
      return el ? String(el.value || "").trim() : "";
    };
    var bedrijfsnaam = get("bedrijfsnaam");
    var stad = get("stad");
    var whatsapp = get("whatsapp");
    var omschrijving = get("omschrijving");
    var social = get("social");

    var subject = "Aanvraag Binnen48 — " + bedrijfsnaam + " (" + stad + ")";
    var body = [
      "Aanvraag Binnen48",
      "",
      "Bedrijfsnaam: " + bedrijfsnaam,
      "Stad: " + stad,
      "WhatsApp: " + whatsapp,
      "Omschrijving: " + omschrijving,
      "Instagram/Facebook: " + (social || "—")
    ].join("\n");

    var mailto =
      "mailto:chiefofstaff1880@agentmail.to" +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);

    var a = document.createElement("a");
    a.href = mailto;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.setTimeout(function () {
      window.location.href = "bedankt.html";
    }, 500);
  });
})();
