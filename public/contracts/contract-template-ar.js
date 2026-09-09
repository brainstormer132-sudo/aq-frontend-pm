/**
 * The vendor contract template, as data. GENERATED - do not hand-edit.
 *
 *   node scripts/build-contract-template.mjs "<path to the DOCX>"
 *
 * This is the text of the vendor agreement broken into blocks, with the
 * {{ placeholders }} left exactly where Word has them. The contract app's
 * Preview fills them from the subtask form and draws the result, so what
 * you see on screen is the document rather than a summary of it.
 *
 * The body is Arabic and this repository is edited through an ASCII-only
 * console, so the JSON is base64 here and decoded at load. To read it:
 *
 *   node -e "const t=require('./public/contracts/contract-template-ar.js'); console.log(JSON.stringify(t.template,null,2))"
 *
 * tests/cpv.test.mjs hashes the decoded JSON against SHA256 below, so a
 * truncated paste fails loudly instead of shipping half a contract.
 *
 * What this is NOT: the file that gets generated. That one is rendered by
 * aq-backend from the DOCX in template storage, which an admin can replace
 * from the Templates screen without this file knowing - which is why the
 * preview names the template on screen and says so. The durable fix is a
 * /api/contracts/preview route on the backend; until then, re-run the
 * generator whenever the DOCX changes.
 */

(function (root) {
  "use strict";

  var SHA256 = "0c4dd705eb2b72b04d9e83677958f402d0f00e1e4310e4cf90b786d5eef040c6";

  var CHUNKS = [
    "eyJrZXkiOiJhZnRlcl9wYXkiLCJsYWJlbCI6IjYwLzkwIiwiYmxvY2tzIjpbeyJ0IjoidGl0bGUiLCJ2IjoiXCIg2KfYqtmB",
    "2KfZgtmK2Kkg2KrYs9mI2YrZgiDYp9mE2YPYqtix2YjZhtmKXCIifSx7InQiOiJwIiwidiI6Itin2YTYrdmF2K8g2YTZhNmH",
    "INmI2K3Yr9mHINmI2KfZhdinINio2LnYrzoifSx7InQiOiJwIiwidiI6Itij2YbZhyDZgdmKINiq2KfYsdmK2K4ge3sgZGF0",
    "ZSB9fSDZhS4g2KfZhNmF2YjYp9mB2YIge3sgZGF5IH19INit2LHYsdiqINmH2LDZhyDYp9mE2KfYqtmB2KfZgtmK2KkgKNmK",
    "2LTYp9ixINin2YTZitmH2KcgXCLYqNin2YTYp9iq2YHYp9mC2YrYqVwiKSDYqNmK2YYg2YPZhCDZhdmGOiJ9LHsidCI6InAi",
    "LCJ2Ijoi2KfZhNi32LHZgSDYp9mE2KPZiNmEIDog2LTYsdmD2Kkg2LHZiNin2K8g2KfZhNiq2KPYq9mK2LEgLCDYs9is2YQg",
    "2KrYrNin2LHZiiDYsdmC2YUgKCA0MDMwMzgxNDcyKSAsINin2YTYsdmC2YUg2KfZhNmI2LfZhtmKINin2YTZhdmI2K3YryAo",
    "IDcwMTcyMjkyMzMpICwg2KfZhNix2YLZhSDYp9mE2LbYsdmK2KjZiiAoIDMxNDg5OTkyODcwMDAwMykgLCDYp9mE2LnZhtmI",
    "2KfZhiA6INin2YTZhdmF2YTZg9ipINin2YTYudix2KjZitipINin2YTYs9i52YjYr9mK2KkgLCDYrNiv2KkgLCDYrdmKINin",
    "2YTZgdmK2LXZhNmK2Kkg2LfYsdmK2YIg2KfZhNmF2K/ZitmG2Kkg2KfZhNmF2YbZiNix2Kkg2YHYsdi52YogLCDYp9mE2LHZ",
    "hdiyINin2YTYqNix2YrYr9mKICggMjM0NDIpICwg2Ygg2YrZhdir2YTZh9inINin2YTYo9iz2KrYp9iwIC8g2KfYrdmF2K8g",
    "2YLYsdmG2YHZhNipINio2LXZgdiq2Ycg2KfZhNmF2K/ZitixINin2YTYudin2YUuIn0seyJ0IjoicCIsInYiOiLYp9mE2LfY",
    "sdmBINin2YTYq9in2YbZiiA6IHt7IGxpY2Vuc2VfbmFtZSB9fSDigJMg2LHZgtmFINin2YTYqtix2K7Ziti1INin2YTYpdi5",
    "2YTYp9mF2YogKCB7eyBsaWNlbnNlX251bWJlciB9fSApIn0seyJ0IjoicCIsInYiOiLYqtmF2YfZitivOiDYrdmK2Ksg2KPZ",
    "hiDYp9mE2LfYsdmBINin2YTYp9mI2YQg2LTYsdmD2Kkg2YbYtNin2LfZh9inINiq2YLYr9mK2YUg2K7Yr9mF2KfYqiDYqtiz",
    "2YjZitmC2YrYqSDZiNiv2LnYp9mK2Kkg2YjYpdi52YTYp9mGINmG2YrYp9io2KnZiyDYudmGINin2YTYutmK2LEg2Iwg2YjY",
    "p9mE2LfYsdmBINin2YTYq9in2YbZiiDZhdi52YTZhiDZgdmKINmF2YjYp9mC2Lkg2KfZhNiq2YjYp9i12YQg2KfZhNin2KzY",
    "qtmF2KfYudmKLiDZiNmK2LHYutioINin2YTYt9ix2YEg2KfZhNij2YjZhCDYqNin2YTYp9iq2YHYp9mCINmF2Lkg2KfZhNi3",
    "2LHZgSDYp9mE2KvYp9mG2Yog2YHZitmF2Kcg2YrYrti1INiv2LnYp9mK2Kkg2YjYp9i52YTYp9mGLiJ9LHsidCI6ImgiLCJ2",
    "Ijoi2KPZiNmE2YvYpzog2YrYudiq2KjYsSDYp9mE2KrZhdmH2YrYryDYrNiy2KHZi9inINmE2Kcg2YrYqtis2LLYoyDZhdmG",
    "INmH2LDZhyDYp9mE2KfYqtmB2KfZgtmK2Kk6In0seyJ0Ijoic2lnIiwicmlnaHQiOiLYp9mE2YXZhtiq2KzYp9iqINin2YTY",
    "qtmKINmK2KrZhSDYqtix2YjZitis2YfYpzoiLCJsZWZ0Ijoie3sgYnJhbmRfbmFtZSB9fSJ9LHsidCI6ImgiLCJ2Ijoi2KvY",
    "p9mG2YrZi9inOiDZhdmI2LbZiNi5INin2YTYudmC2K86In0seyJ0IjoicCIsInYiOiLYqNmF2YjYrNioINmH2LDYpyDYp9mE",
    "2LnZgtivINin2KrZgdmCINin2YTYt9ix2YHYp9mGINin2YYg2YrZgtmI2YUg2KfZhNi32LHZgSDYp9mE2KfZiNmEINio2K3Y",
    "rNiyINiu2K/Zhdin2Kog2LnZhNmJINmF2YjYp9mC2Lkg2KfZhNiq2YjYp9i12YQg2KfZhNin2KzYqtmF2KfYudmKINi52YTZ",
    "iSDYp9mE2YbYrdmIINin2YTYqtin2YTZiiDZhdi5OiJ9LHsidCI6InRhYmxlIiwicm93cyI6W1si2KfZhNmF2KTYq9ixIiwi",
    "2KfZhNmF2YbYtdipIiwi2K3Ys9in2KjZhyDZgdmKINin2YTZhdmG2LXYqSIsItmG2YjYuSDYp9mE2KXYudmE2KfZhiJdLFsi",
    "e3sgbmFtZV8yIH19Iiwie3sgcGxhdGZvcm1fc21hcnQgfX0iLCJ7eyBjaGFubmVsX25hbWUgfX0iLCJ7eyBhZF90eXBlcyB9",
    "fSJdXX0seyJ0IjoiaCIsInYiOiLYq9in2YTYq9mL2Kc6INin2YTYr9mB2Lk6In0seyJ0IjoicCIsInYiOiLYp9mGINmK2LPY",
    "r9ivINin2YTYt9ix2YEg2KfZhNin2YjZhCDZhNmAINin2YTYt9ix2YEg2KfZhNir2KfZhtmKINmF2KjZhNi6INin2YTYp9i5",
    "2YTYp9mGINmI2YLYr9ix2Ycge3sgQW1vdW50X2Z1bGwgfX0g2LrZitixINi02KfZhdmE2Kkg2KfZhNi22LHZitio2KnYjCDZ",
    "iNiw2YTZgyDYudmGINi32LHZitmCINin2YTYqtit2YjZitmEINin2YTZhdi12LHZgdmKINmE2YTYrdiz2KfYqCDYp9mE2KjZ",
    "htmD2Yog2YjYs9iq2YPZiNmGINin2YTYrdmI2KfZhNipINiu2YTYp9mEIHt7IGR1cmF0aW9uIH19INmK2YjZhSDYqNi52K8g",
    "2KfZhtiq2YfYp9ihINin2YTYrdmF2YTYqSDYp9mE2KfYudmE2KfZhtmK2KkuIn0seyJ0IjoicCIsInYiOiLZitmC2LEg2KfZ",
    "hNi32LHZgSDYp9mE2KvYp9mG2Yog2KjYtdit2Kkg2KfZhNio2YrYp9mG2KfYqiDYp9mE2KjZhtmD2YrYqSDYp9mE2YXYsdiz",
    "2YTYqSDZhdmGINmC2KjZhNmHINiz2YjYp9ihINmD2KfZhtiqINio2KfYs9mF2Ycg2KfZiCDYqNin2LPZhSDYt9ix2YEg2KvY",
    "p9mE2KsgLCDZiCDZitiq2K3ZhdmEINin2YTYt9ix2YEg2KfZhNir2KfZhtmKINmD2KfZhdmEINin2YTZhdiz2KTZiNmE2YrY",
    "qSDYudmGINin2K7YqtmK2KfYsSDYp9mE2K3Ys9in2Kgg2KfZhNio2YbZg9mKICwg2Ygg2KjYp9mE2KrYp9mE2Yog2YrYudiv",
    "INij2Yog2KrYrdmI2YrZhCDZitiq2YUg2KfYqNix2KfYodmLINmE2LDZhdipINin2YTYt9ix2YEg2KfZhNij2YjZhC4ifSx7",
    "InQiOiJwIiwidiI6Itiz2YrYqtmFINin2YTYqtit2YjZitmEINio2KfZhNmF2LnZhNmI2YXYp9iqINin2YTYqtin2YTZitip",
    "OiJ9LHsidCI6Imt2IiwidiI6Itin2LPZhSDYp9mE2KjZhtmDIDoge3sgYmFua19uYW1lIH19In0seyJ0Ijoia3YiLCJ2Ijoi",
    "2KfYs9mFINin2YTYrdiz2KfYqDoge3sgYWNjb3VudF9uYW1lIH19In0seyJ0Ijoia3YiLCJ2Ijoi2LHZgtmFINin2YTYrdiz",
    "2KfYqDoge3sgYWNjb3VudF9udW1iZXIgfX0ifSx7InQiOiJrdiIsInYiOiLYsdmC2YUg2KfZhNin2YrYqNin2YY6IOKAj+KA",
    "j+KAjyB7eyBpYmFuIH19In0seyJ0IjoiaCIsInYiOiLYsdin2KjYudin2Ys6INi02LHZiCDYtyDZiNij2K3Zg9in2YU6In0s",
    "eyJ0IjoibGkiLCJ2IjoiLdin2YTYp9mE2KrYstin2YUg2KjYp9mE2KrZiNin2LHZitiuINin2YTZhdiq2YHZgiDYudmE2YrZ",
    "h9inINmI2KrYt9io2YrZgiDYp9mE2YXYrdiq2YjZiSDZg9in2YXZhNin2Ysg2YPZhdinINmH2Ygg2YXYt9mE2YjYqCDZhdmG",
    "INmC2KjZhCDYp9mE2LnZhdmK2YQg2YjYp9mGINmK2KrZhSDZhdi02KfYsdmD2Kkg2KfZhNmF2K3YqtmI2Ykg2YLYqNmEINmG",
    "2LTYsdmHINmE2YTYqtij2YPZitivINi52YTZitmHINmF2YYg2YLYqNmEINin2YTYudmF2YrZhC4ifSx7InQiOiJsaSIsInYi",
    "OiItINin2YTYtNix2YjYtyDYp9mE2KjYp9i32YTYqTog2KXZhiDYqNi32YTYp9mGINij2Yog2KjZhtivINmF2YYg2KjZhtmI",
    "2K8g2YfYsNinIFwi2KfZhNi52YLYr1wiINmE2Kcg2YrYpNir2LEg2LnZhNmJINio2YLZitipINio2YbZiNivIFwi2KfZhNi5",
    "2YLYr1wiINin2YTYqtmKINiq2LjZhCDYs9in2LHZitipINmI2YXZhtiq2KzYqSDZhNij2KvYp9ix2YfYpyDYqNmK2YYgXCLY",
    "p9mE2LfYsdmB2YrZhlwiLiDYp9mE2Kcg2KfYsNinINiq2KjZitmGINin2YYg2KfYrdivINin2YTZhdiq2LnYp9mC2K/ZitmG",
    "INmF2Kcg2YPYp9mGINmE2YrYsdi22Ykg2KjYp9mE2LnZgtivINiv2YjZhiDYsNmE2YMg2KfZhNio2YbYryDZgdmE2Ycg2K3Z",
    "giDYt9mE2Kgg2KfYqNi32KfZhCDYp9mE2LnZgtivLiJ9LHsidCI6ImxpIiwidiI6Ii0g2YrYrNioINin2LHYs9in2YQg2KXY",
    "rdi12KfYodin2Kog2KfZhNil2LnZhNin2YYg2KjYudivINmG2LLZiNmE2Yc6In0seyJ0IjoibGkiLCJ2IjoiLSDYpdit2LXY",
    "p9ih2KfYqiBcIiDYqtmK2YMg2KrZiNmDXCIgLCBcIiDYp9mG2LPYqtmC2LHYp9mFINio2YjYs9iqINmIINix2YrZitmEXCIg",
    "LCDZhNinINiq2KrYrNin2YjYsiA3INij2YrYp9mFINmF2YYg2KrYp9ix2YrYriDZhtiy2YjZhCDYp9mE2KXYudmE2KfZhi4i",
    "fSx7InQiOiJsaSIsInYiOiItINil2K3Ytdin2KHYp9iqIFwiINin2YbYs9iq2YLYsdin2YUg2Ygg2LPZhtin2Kgg2KrYtNin",
    "2Kog2LPYqtmI2LHZilwiINmE2Kcg2KrYqtis2KfZiNiyIDI0INiz2KfYudipINmF2YYg2KrYp9ix2YrYriDZhtiy2YjZhCDY",
    "p9mE2KXYudmE2KfZhi4ifSx7InQiOiJoIiwidiI6Itiu2KfZhdiz2KfZizog2KXZhtmH2KfYoSDYp9mE2LnZgtivINin2Ygg",
    "2LfZhNioINiq2LrZitmK2LEg2YHZiiDZhdmI2LbZiNi5INin2YTYudmC2K86In0seyJ0IjoicCIsInYiOiLZgdmKINit2KfZ",
    "hCDYsdi62KggXCLYp9mE2LfYsdmBINin2YTYq9in2YbZilwiINmB2Yog2KfZhtmH2KfYoSDYp9mE2LnZgtivINmIINmK2YjY",
    "rNivINmF2YbYqtis2KfYqiDZhdix2LPZhNipINmF2YYg2YLYqNmEIFwi2KfZhNi32LHZgSDYp9mE2KPZiNmEXCIg2YrZhNiq",
    "2LLZhSBcItin2YTYt9ix2YEg2KfZhNir2KfZhtmKXCIg2YHZiiDYp9ix2KzYp9i52YfYpyDZhdi5INiq2K3ZhdmEINmC2YrZ",
    "hdipINin2YTYp9ix2KzYp9i5INin2YYg2YjYrNiv2KouIn0seyJ0IjoicCIsInYiOiLZgdmKINit2KfZhCDYsdi62KggXCLY",
    "p9mE2LfYsdmBINin2YTYq9in2YbZilwiINmB2Yog2KfZhtmH2KfYoSDYp9mE2LnZgtivINmIINmK2YjYrNivINmF2KjYp9mE",
    "2Log2KrZhSDYr9mB2LnZh9inIFwi2YTZhNi32LHZgSDYp9mE2KvYp9mG2YpcIiDZhdmGINmC2KjZhCBcItin2YTYt9ix2YEg",
    "2KfZhNij2YjZhFwiINmK2YTYqtiy2YUgXCLYp9mE2LfYsdmBINin2YTYq9in2YbZilwiINmB2Yog2KfYsdis2KfYudmH2Kcu",
    "In0seyJ0IjoicCIsInYiOiLZhNinINmK2YXZg9mGIFwiINmE2YTYt9ix2YEg2KfZhNir2KfZhtmKXCIg2LfZhNioINiq2YLZ",
    "hNmK2YQg2LnYr9ivINin2YTYrtiv2YXYp9iqINin2YTZhdiq2YHZgiDYudmE2YrZh9inINmB2YogXCIg2YXZiNi22YjYuSDY",
    "p9mE2LnZgtivIFwiLiDYrdmK2Ksg2KfZhiDYp9mE2KPYs9i52KfYsSDYp9mE2YXYudi32KfYqSDZhdix2KrYqNi32Kkg2KfY",
    "sdiq2KjYp9i3INmD2YTZiiDYqNi52K/YryDYp9mE2K7Yr9mF2KfYqiDYp9mE2YPZhdmKLiJ9LHsidCI6InAiLCJ2Ijoi2YrY",
    "qtmFINin2LHYrNin2Lkg2KfZhNmF2KjYp9mE2Log2LnZhiDYt9ix2YrZgiDYp9mE2KrYrdmI2YrZhCDYp9mE2KjZhtmD2Yog",
    "2LnZhNmJINit2LPYp9ioINin2YTZhdik2LPYs9ipINio2KfZhNmF2LnZhNmI2YXYp9iqINin2YTYqtin2YTZitipOiJ9LHsi",
    "dCI6Imt2IiwidiI6Itin2YTYqNmG2YMgOiDYp9mE2KfZhtmF2KfYoSJ9LHsidCI6Imt2IiwidiI6Itin2LPZhSDYp9mE2K3Y",
    "s9in2Kg6INi02LHZg9ipINix2YjYp9ivINin2YTYqtij2KvZitixIn0seyJ0Ijoia3YiLCJ2Ijoi2LHZgtmFINin2YTYrdiz",
    "2KfYqCA6IDY4MjAyNzA3ODI0MDAwIn0seyJ0Ijoia3YiLCJ2Ijoi2LHZgtmFINin2YTYp9mK2KjYp9mGOiBTQTg1MDUwMDAw",
    "NjgyMDI3MDc4MjQwMDAifSx7InQiOiJoIiwidiI6Itiz2KfYr9iz2KfZizog2KfZhNil2K7Yt9in2LEg2YjYp9mE2YXYsdin",
    "2LPZhNin2Ko6In0seyJ0IjoicCIsInYiOiLYqti52KrYqNixINin2YTZhdmI2KfZgdmC2Kkg2KfZhNil2YTZg9iq2LHZiNmG",
    "2YrYqSDZg9in2YHZitipINmB2Yog2K3Yr9mI2Ksg2KPZiiDYpdi02LnYp9ixINix2LPZhdmKINio2YrZhiDZg9mEINmF2YYg",
    "2KfZhNi32LHZgdmK2YbYjCDZiNiw2YTZgyDZitiq2LbZhdmGINin2YTYqNix2YrYryDYp9mE2KXZhNmD2KrYsdmI2YbZitiM",
    "INmI2KfZhNix2LPYp9im2YQg2KfZhNmG2LXZitip2Iwg2YjYp9mE2LHYs9in2KbZhCDZhdmGINiu2YTYp9mEINiq2LfYqNmK",
    "2YIg2KfZhNmI2KfYqtiz2KfYqNiMINij2Ygg2KPZiiDZiNiz2YrZhNipINin2KrYtdin2YQg2K3Yr9mK2KvYqS4g2YPZhdin",
    "INmK2KzYqCDYo9mGINmK2YPZiNmGINin2YTYsdivINiu2YTYp9mEINmF2K/YqSDYo9mC2LXYp9mH2Kcg2YrZiNmF2YrZhiDZ",
    "hdmGINiq2KfYsdmK2K4g2KfZhNil2LHYs9in2YQg2YjZitmE2KrYstmFINin2YTYt9ix2YHYp9mGINio2KjZitin2YYg2KPZ",
    "hiDYp9mE2YXYrdiq2YjZiSDYp9mE2LDZiiDZitiq2YUg2KrYtdmI2YrYsdmHINmF2YYg2YLYqNmEINmF2KTYq9ixINin2YTY",
    "qtmI2KfYtdmEINin2YTYp9is2KrZhdin2LnZiiDZh9mIINil2LnZhNin2YYg2KfZhNiq2LLYp9mF2KfZiyDYqNi22YjYp9io",
    "2Lcg2KfZhNil2LnZhNin2YbYp9iqINmB2Yog2KfZhNmF2YXZhNmD2Kkg2KfZhNi52LHYqNmK2Kkg2KfZhNiz2LnZiNiv2YrY",
    "qS4ifSx7InQiOiJoIiwidiI6Itiz2KfYqNi52KfZizog2KfZhNmG2LLYp9i52KfYqjoifSx7InQiOiJwIiwidiI6ItmB2Yog",
    "2K3Yp9mE2Kkg2YbYtNmI2KEg2YbYstin2Lkg2KjZitmGINin2YTYt9ix2YHZitmGIFwi2YTYpyDYs9mF2K0g2KfZhNmE2Ydc",
    "IiDZitmE2KzYoyDZhNmF2K3Yp9mD2YUg2KfZhNmF2YXZhNmD2Kkg2KfZhNi52LHYqNmK2Kkg2KfZhNiz2LnZiNiv2YrYqSDZ",
    "hNmE2YHYtdmEINmB2Yog2YfYsNinINin2YTZhtiy2KfYuS4ifSx7InQiOiJjZW50ZXIiLCJ2Ijoi2KrZhSDYqtit2LHZitix",
    "INmH2LDYpyDYp9mE2LnZgtivINmF2YYg2YbYs9iu2KrZitmG2Iwg2YjYqtiz2YTZitmFINmD2YQg2LfYsdmBINmG2LPYrtip",
    "INmF2YbZhy4g2YjYudmE2YrZhyDYrNix2Ykg2KfZhNiq2YjZgtmK2Lk6In0seyJ0IjoiY2VudGVyIiwidiI6ItmI2KfZhNmE",
    "2Ycg2KfZhNmF2YjZgdmCLiJ9LHsidCI6InNpZyIsInJpZ2h0Ijoi2KfZhNi32LHZgSDYp9mE2KPZiNmEOiAg2KfYrdmF2K8g",
    "2YLYsdmG2YHZhNipIiwibGVmdCI6Itin2YTYt9ix2YEg2KfZhNir2KfZhtmKOiJ9XSwic3RyaW5ncyI6eyJtaXNzaW5nIjoi",
    "2LrZitixINmF2K/YrtmEIiwicGVuZGluZyI6ItmK2Y/Yttin2YEg2LnZhtivINin2YTYpdmG2LTYp9ihIiwicml5YWwiOiLY",
    "sdmK2KfZhCDYs9i52YjYr9mKIiwiZGF5cyI6ItmK2YjZhSJ9fQ==",
  ];

  function decodeBase64(b64) {
    if (typeof atob === "function") {
      var binary = atob(b64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    }
    return Buffer.from(b64, "base64").toString("utf8");
  }

  var json = decodeBase64(CHUNKS.join(""));
  var template = JSON.parse(json);
  template.sha256 = SHA256;

  var api = { template: template, json: json, sha256: SHA256 };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.AQContractTemplateAr = api;
})(typeof window !== "undefined" ? window : null);
