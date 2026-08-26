(function () {
  var form = document.getElementById("intake");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var get = function (name) {
      var el = form.elements[name];
      return el ? String(el.value || "").trim() : "";
    };

    var isNl = (document.documentElement.lang || "").toLowerCase().indexOf("nl") === 0;
    var name = get("bedrijfsnaam") || get("business");
    var city = get("stad") || get("city");
    var contact = get("whatsapp") || get("contact");
    var description = get("omschrijving") || get("description");
    var social = get("social");

    var subject, body, thanks;
    if (isNl) {
      subject = "Aanvraag Binnen48 — " + name + " (" + city + ")";
      body = [
        "Aanvraag Binnen48",
        "",
        "Bedrijfsnaam: " + name,
        "Stad: " + city,
        "WhatsApp: " + contact,
        "Omschrijving: " + description,
        "Instagram/Facebook: " + (social || "—")
      ].join("\n");
      thanks = "bedankt.html";
    } else {
      subject = "Binnen48 request — " + name + " (" + city + ")";
      body = [
        "Binnen48 request",
        "",
        "Business: " + name,
        "City: " + city,
        "WhatsApp / email: " + contact,
        "Description: " + description,
        "Instagram / Facebook: " + (social || "—")
      ].join("\n");
      thanks = "thanks.html";
    }

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
      window.location.href = thanks;
    }, 500);
  });
})();
