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

  var SHA256 = "5130d75593eb95433b4b23514fe452cad58f9f46d8307d081d3a612c74e77f81";

  var CHUNKS = [
    "eyJrZXkiOiIiLCJsYWJlbCI6IlJhd2FkIGFsdGF0aGlyIFVHQyIsImJsb2NrcyI6W3sidCI6ImlkIiwidiI6Int7IGlkIH19",
    "In0seyJ0IjoidGl0bGUiLCJ2IjoiXCIg2KfYqtmB2KfZgtmK2Kkg2KrYs9mI2YrZgiDYp9mE2YPYqtix2YjZhtmKXCIifSx7",
    "InQiOiJwIiwidiI6Itin2YTYrdmF2K8g2YTZhNmHINmI2K3Yr9mHINmI2KfZhdinINio2LnYrzoifSx7InQiOiJwIiwidiI6",
    "Itij2YbZhyDZgdmKINiq2KfYsdmK2K4ge3sgZGF0ZSB9fSDZhS4g2KfZhNmF2YjYp9mB2YIge3sgZGF5IH19INit2LHYsdiq",
    "INmH2LDZhyDYp9mE2KfYqtmB2KfZgtmK2KkgKNmK2LTYp9ixINin2YTZitmH2KcgXCLYqNin2YTYp9iq2YHYp9mC2YrYqVwi",
    "KSDYqNmK2YYg2YPZhCDZhdmGOiJ9LHsidCI6InAiLCJ2Ijoi2KfZhNi32LHZgSDYp9mE2KPZiNmEIDog2LTYsdmD2Kkg2LHZ",
    "iNin2K8g2KfZhNiq2KPYq9mK2LEgLCDYs9is2YQg2KrYrNin2LHZiiDYsdmC2YUgKCA0MDMwMzgxNDcyKSAsINin2YTYsdmC",
    "2YUg2KfZhNmI2LfZhtmKINin2YTZhdmI2K3YryAoIDcwMTcyMjkyMzMpICwg2KfZhNix2YLZhSDYp9mE2LbYsdmK2KjZiiAo",
    "IDMxNDg5OTkyODcwMDAwMykgLCDYp9mE2LnZhtmI2KfZhiA6INin2YTZhdmF2YTZg9ipINin2YTYudix2KjZitipINin2YTY",
    "s9i52YjYr9mK2KkgLCDYrNiv2KkgLCDYrdmKINin2YTZgdmK2LXZhNmK2Kkg2LfYsdmK2YIg2KfZhNmF2K/ZitmG2Kkg2KfZ",
    "hNmF2YbZiNix2Kkg2YHYsdi52YogLCDYp9mE2LHZhdiyINin2YTYqNix2YrYr9mKICggMjM0NDIpICwg2Ygg2YrZhdir2YTZ",
    "h9inINin2YTYo9iz2KrYp9iwIC8g2KfYrdmF2K8g2YLYsdmG2YHZhNipINio2LXZgdiq2Ycg2KfZhNmF2K/ZitixINin2YTY",
    "udin2YUuIn0seyJ0IjoicCIsInYiOiLYp9mE2LfYsdmBINin2YTYq9in2YbZijoge3sgbGljZW5zZV9uYW1lIH19IOKAkyDY",
    "sdmC2YUg2KfZhNiq2LHYrtmK2LUg2KfZhNil2LnZhNin2YXZiiAoIHt7IGxpY2Vuc2VfbnVtYmVyIH19ICkifSx7InQiOiJw",
    "IiwidiI6Itiq2YXZh9mK2K86INit2YrYqyDYo9mGINin2YTYt9ix2YEg2KfZhNin2YjZhCDYtNix2YPYqSDZhti02KfYt9mH",
    "2Kcg2KrZgtiv2YrZhSDYrtiv2YXYp9iqINiq2LPZiNmK2YLZitipINmI2K/Yudin2YrYqSDZiNil2LnZhNin2YYg2YbZitin",
    "2KjYqdmLINi52YYg2KfZhNi62YrYsSDYjCDZiNin2YTYt9ix2YEg2KfZhNir2KfZhtmKINmF2LnZhNmGINmB2Yog2YXZiNin",
    "2YLYuSDYp9mE2KrZiNin2LXZhCDYp9mE2KfYrNiq2YXYp9i52YouINmI2YrYsdi62Kgg2KfZhNi32LHZgSDYp9mE2KPZiNmE",
    "INio2KfZhNin2KrZgdin2YIg2YXYuSDYp9mE2LfYsdmBINin2YTYq9in2YbZiiDZgdmK2YXYpyDZitiu2LUg2K/Yudin2YrY",
    "qSDZiNin2LnZhNin2YYuIn0seyJ0IjoiaCIsInYiOiLYo9mI2YTZi9inOiDZiti52KrYqNixINin2YTYqtmF2YfZitivINis",
    "2LLYodmL2Kcg2YTYpyDZitiq2KzYstijINmF2YYg2YfYsNmHINin2YTYp9iq2YHYp9mC2YrYqToifSx7InQiOiJwIiwidiI6",
    "Itin2YTZhdmG2KrYrNin2Kog2KfZhNiq2Yog2YrYqtmFINiq2LHZiNmK2KzZh9inOiB7eyBicmFuZF9uYW1lIH19In0seyJ0",
    "IjoiaCIsInYiOiLYq9in2YbZitmL2Kc6INmF2YjYttmI2Lkg2KfZhNi52YLYrzoifSx7InQiOiJwIiwidiI6Itio2YXZiNis",
    "2Kgg2YfYsNinINin2YTYudmC2K8g2KfYqtmB2YIg2KfZhNi32LHZgdin2YYg2KfZhiDZitmC2YjZhSDYp9mE2LfYsdmBINin",
    "2YTYp9mI2YQg2KjYrdis2LIg2K7Yr9mF2KfYqiDYudmE2Ykg2YXZiNin2YLYuSDYp9mE2KrZiNin2LXZhCDYp9mE2KfYrNiq",
    "2YXYp9i52Yog2LnZhNmJINin2YTZhtit2Ygg2KfZhNiq2KfZhNmKINmF2Lk6In0seyJ0IjoidGFibGUiLCJyb3dzIjpbWyLY",
    "p9mE2YXYpNir2LEiLCLYp9mE2YXZhti12KkiLCLYrdiz2KfYqNmHINmB2Yog2KfZhNmF2YbYtdipIiwi2YbZiNi5INin2YTY",
    "pdi52YTYp9mGIl0sWyJ7eyBuYW1lXzIgfX0iLCJ7eyBwbGF0Zm9ybV9zbWFydCB9fSIsInt7IGNoYW5uZWxfbmFtZSB9fSIs",
    "Int7IGFkX3R5cGVzIH19Il1dfSx7InQiOiJoIiwidiI6Itir2KfZhNir2YvYpzog2KfZhNiv2YHYuToifSx7InQiOiJwIiwi",
    "diI6Itin2YYg2YrYs9iv2K8g2KfZhNi32LHZgSDYp9mE2KfZiNmEINmE2YAg2KfZhNi32LHZgSDYp9mE2KvYp9mG2Yog2YXY",
    "qNmE2Log2KfZhNin2LnZhNin2YYg2YjZgtiv2LHZhyB7eyBBbW91bnRfZnVsbCB9fSDYutmK2LEg2LTYp9mF2YTYqSDYp9mE",
    "2LbYsdmK2KjYqdiMINmI2LDZhNmDINi52YYg2LfYsdmK2YIg2KfZhNiq2K3ZiNmK2YQg2KfZhNmF2LXYsdmB2Yog2YTZhNit",
    "2LPYp9ioINin2YTYqNmG2YPZiiDZiNiz2KrZg9mI2YYg2KfZhNit2YjYp9mE2Kkg2K7ZhNin2YQge3sgZHVyYXRpb24gfX0g",
    "2YrZiNmFINio2LnYryDYp9mG2KrZh9in2KEg2KfZhNit2YXZhNipINin2YTYp9i52YTYp9mG2YrYqS4ifSx7InQiOiJwIiwi",
    "diI6ItmK2YLYsSDYp9mE2LfYsdmBINin2YTYq9in2YbZiiDYqNi12K3YqSDYp9mE2KjZitin2YbYp9iqINin2YTYqNmG2YPZ",
    "itipINin2YTZhdix2LPZhNipINmF2YYg2YLYqNmE2Ycg2LPZiNin2KEg2YPYp9mG2Kog2KjYp9iz2YXZhyDYp9mIINio2KfY",
    "s9mFINi32LHZgSDYq9in2YTYqyAsINmIINmK2KrYrdmF2YQg2KfZhNi32LHZgSDYp9mE2KvYp9mG2Yog2YPYp9mF2YQg2KfZ",
    "hNmF2LPYpNmI2YTZitipINi52YYg2KfYrtiq2YrYp9ixINin2YTYrdiz2KfYqCDYp9mE2KjZhtmD2YogLCDZiCDYqNin2YTY",
    "qtin2YTZiiDZiti52K8g2KPZiiDYqtit2YjZitmEINmK2KrZhSDYp9io2LHYp9ih2Ysg2YTYsNmF2Kkg2KfZhNi32LHZgSDY",
    "p9mE2KPZiNmELiJ9LHsidCI6InAiLCJ2Ijoi2LPZitiq2YUg2KfZhNiq2K3ZiNmK2YQg2KjYp9mE2YXYudmE2YjZhdin2Kog",
    "2KfZhNiq2KfZhNmK2Kk6In0seyJ0Ijoia3YiLCJ2Ijoi2KfYs9mFINin2YTYqNmG2YM6IHt7IGJhbmtfbmFtZSB9fSJ9LHsi",
    "dCI6Imt2IiwidiI6Itin2LPZhSDYp9mE2K3Ys9in2Kg6IOKAjiB7eyBhY2NvdW50X25hbWUgfX0ifSx7InQiOiJrdiIsInYi",
    "OiLYsdmC2YUg2KfZhNit2LPYp9ioIDoge3sgYWNjb3VudF9udW1iZXIgfX0ifSx7InQiOiJrdiIsInYiOiLYsdmC2YUg2KfZ",
    "hNin2YrYqNin2YYgOiB7eyBpYmFuIH19In0seyJ0IjoiaCIsInYiOiLYsdin2KjYudin2Ys6INi02LHZiCDYtyDZiNij2K3Z",
    "g9in2YU6In0seyJ0IjoibGkiLCJ2IjoiLdin2YTYp9mE2KrYstin2YUg2KjYp9mE2KrZiNin2LHZitiuINin2YTZhdiq2YHZ",
    "giDYudmE2YrZh9inINmI2KrYt9io2YrZgiDYp9mE2YXYrdiq2YjZiSDZg9in2YXZhNin2Ysg2YPZhdinINmH2Ygg2YXYt9mE",
    "2YjYqCDZhdmGINmC2KjZhCDYp9mE2LnZhdmK2YQg2YjYp9mGINmK2KrZhSDZhdi02KfYsdmD2Kkg2KfZhNmF2K3YqtmI2Ykg",
    "2YLYqNmEINmG2LTYsdmHINmE2YTYqtij2YPZitivINi52YTZitmHINmF2YYg2YLYqNmEINin2YTYudmF2YrZhC4ifSx7InQi",
    "OiJsaSIsInYiOiItINin2YTYtNix2YjYtyDYp9mE2KjYp9i32YTYqTog2KXZhiDYqNi32YTYp9mGINij2Yog2KjZhtivINmF",
    "2YYg2KjZhtmI2K8g2YfYsNinIFwi2KfZhNi52YLYr1wiINmE2Kcg2YrYpNir2LEg2LnZhNmJINio2YLZitipINio2YbZiNiv",
    "IFwi2KfZhNi52YLYr1wiINin2YTYqtmKINiq2LjZhCDYs9in2LHZitipINmI2YXZhtiq2KzYqSDZhNij2KvYp9ix2YfYpyDY",
    "qNmK2YYgXCLYp9mE2LfYsdmB2YrZhlwiLiDYp9mE2Kcg2KfYsNinINiq2KjZitmGINin2YYg2KfYrdivINin2YTZhdiq2LnY",
    "p9mC2K/ZitmGINmF2Kcg2YPYp9mGINmE2YrYsdi22Ykg2KjYp9mE2LnZgtivINiv2YjZhiDYsNmE2YMg2KfZhNio2YbYryDZ",
    "gdmE2Ycg2K3ZgiDYt9mE2Kgg2KfYqNi32KfZhCDYp9mE2LnZgtivLiJ9LHsidCI6ImxpIiwidiI6Ii0g2YrYrNioINin2LHY",
    "s9in2YQg2KXYrdi12KfYodin2Kog2KfZhNil2LnZhNin2YYg2KjYudivINmG2LLZiNmE2Yc6In0seyJ0IjoibGkiLCJ2Ijoi",
    "LSDYpdit2LXYp9ih2KfYqiBcIiDYqtmK2YMg2KrZiNmDXCIgLCBcIiDYp9mG2LPYqtmC2LHYp9mFINio2YjYs9iqINmIINix",
    "2YrZitmEXCIgLCDZhNinINiq2KrYrNin2YjYsiA3INij2YrYp9mFINmF2YYg2KrYp9ix2YrYriDZhtiy2YjZhCDYp9mE2KXY",
    "udmE2KfZhi4ifSx7InQiOiJsaSIsInYiOiItINil2K3Ytdin2KHYp9iqIFwiINin2YbYs9iq2YLYsdin2YUg2Ygg2LPZhtin",
    "2Kgg2KrYtNin2Kog2LPYqtmI2LHZilwiINmE2Kcg2KrYqtis2KfZiNiyIDI0INiz2KfYudipINmF2YYg2KrYp9ix2YrYriDZ",
    "htiy2YjZhCDYp9mE2KXYudmE2KfZhi4ifSx7InQiOiJoIiwidiI6Itiu2KfZhdiz2KfZizog2KXZhtmH2KfYoSDYp9mE2LnZ",
    "gtivINin2Ygg2LfZhNioINiq2LrZitmK2LEg2YHZiiDZhdmI2LbZiNi5INin2YTYudmC2K86In0seyJ0IjoicCIsInYiOiLZ",
    "gdmKINit2KfZhCDYsdi62KggXCLYp9mE2LfYsdmBINin2YTYq9in2YbZilwiINmB2Yog2KfZhtmH2KfYoSDYp9mE2LnZgtiv",
    "INmIINmK2YjYrNivINmF2YbYqtis2KfYqiDZhdix2LPZhNipINmF2YYg2YLYqNmEIFwi2KfZhNi32LHZgSDYp9mE2KPZiNmE",
    "XCIg2YrZhNiq2LLZhSBcItin2YTYt9ix2YEg2KfZhNir2KfZhtmKXCIg2YHZiiDYp9ix2KzYp9i52YfYpyDZhdi5INiq2K3Z",
    "hdmEINmC2YrZhdipINin2YTYp9ix2KzYp9i5INin2YYg2YjYrNiv2KouIn0seyJ0IjoicCIsInYiOiLZgdmKINit2KfZhCDY",
    "sdi62KggXCLYp9mE2LfYsdmBINin2YTYq9in2YbZilwiINmB2Yog2KfZhtmH2KfYoSDYp9mE2LnZgtivINmIINmK2YjYrNiv",
    "INmF2KjYp9mE2Log2KrZhSDYr9mB2LnZh9inIFwi2YTZhNi32LHZgSDYp9mE2KvYp9mG2YpcIiDZhdmGINmC2KjZhCBcItin",
    "2YTYt9ix2YEg2KfZhNij2YjZhFwiINmK2YTYqtiy2YUgXCLYp9mE2LfYsdmBINin2YTYq9in2YbZilwiINmB2Yog2KfYsdis",
    "2KfYudmH2KcuIn0seyJ0IjoicCIsInYiOiLZhNinINmK2YXZg9mGIFwiINmE2YTYt9ix2YEg2KfZhNir2KfZhtmKXCIg2LfZ",
    "hNioINiq2YLZhNmK2YQg2LnYr9ivINin2YTYrtiv2YXYp9iqINin2YTZhdiq2YHZgiDYudmE2YrZh9inINmB2YogXCIg2YXZ",
    "iNi22YjYuSDYp9mE2LnZgtivIFwiLiDYrdmK2Ksg2KfZhiDYp9mE2KPYs9i52KfYsSDYp9mE2YXYudi32KfYqSDZhdix2KrY",
    "qNi32Kkg2KfYsdiq2KjYp9i3INmD2YTZiiDYqNi52K/YryDYp9mE2K7Yr9mF2KfYqiDYp9mE2YPZhdmKLiJ9LHsidCI6InAi",
    "LCJ2Ijoi2YrYqtmFINin2LHYrNin2Lkg2KfZhNmF2KjYp9mE2Log2LnZhiDYt9ix2YrZgiDYp9mE2KrYrdmI2YrZhCDYp9mE",
    "2KjZhtmD2Yog2LnZhNmJINit2LPYp9ioINin2YTZhdik2LPYs9ipINio2KfZhNmF2LnZhNmI2YXYp9iqINin2YTYqtin2YTZ",
    "itipOiJ9LHsidCI6Imt2IiwidiI6Itin2YTYqNmG2YMgOiDYp9mE2KfZhtmF2KfYoSJ9LHsidCI6Imt2IiwidiI6Itin2LPZ",
    "hSDYp9mE2K3Ys9in2Kg6INi02LHZg9ipINix2YjYp9ivINin2YTYqtij2KvZitixIn0seyJ0Ijoia3YiLCJ2Ijoi2LHZgtmF",
    "INin2YTYrdiz2KfYqCA6IDY4MjAyNzA3ODI0MDAwIn0seyJ0Ijoia3YiLCJ2Ijoi2LHZgtmFINin2YTYp9mK2KjYp9mGOiBT",
    "QTg1MDUwMDAwNjgyMDI3MDc4MjQwMDAifSx7InQiOiJoIiwidiI6Itiz2KfYr9iz2KfZizog2KfZhNil2K7Yt9in2LEg2YjY",
    "p9mE2YXYsdin2LPZhNin2Ko6In0seyJ0IjoicCIsInYiOiLYqti52KrYqNixINin2YTZhdmI2KfZgdmC2Kkg2KfZhNil2YTZ",
    "g9iq2LHZiNmG2YrYqSDZg9in2YHZitipINmB2Yog2K3Yr9mI2Ksg2KPZiiDYpdi02LnYp9ixINix2LPZhdmKINio2YrZhiDZ",
    "g9mEINmF2YYg2KfZhNi32LHZgdmK2YbYjCDZiNiw2YTZgyDZitiq2LbZhdmGINin2YTYqNix2YrYryDYp9mE2KXZhNmD2KrY",
    "sdmI2YbZitiMINmI2KfZhNix2LPYp9im2YQg2KfZhNmG2LXZitip2Iwg2YjYp9mE2LHYs9in2KbZhCDZhdmGINiu2YTYp9mE",
    "INiq2LfYqNmK2YIg2KfZhNmI2KfYqtiz2KfYqNiMINij2Ygg2KPZiiDZiNiz2YrZhNipINin2KrYtdin2YQg2K3Yr9mK2KvY",
    "qS4g2YPZhdinINmK2KzYqCDYo9mGINmK2YPZiNmGINin2YTYsdivINiu2YTYp9mEINmF2K/YqSDYo9mC2LXYp9mH2Kcg2YrZ",
    "iNmF2YrZhiDZhdmGINiq2KfYsdmK2K4g2KfZhNil2LHYs9in2YQg2YjZitmE2KrYstmFINin2YTYt9ix2YHYp9mGINio2KjZ",
    "itin2YYg2KPZhiDYp9mE2YXYrdiq2YjZiSDYp9mE2LDZiiDZitiq2YUg2KrYtdmI2YrYsdmHINmF2YYg2YLYqNmEINmF2KTY",
    "q9ixINin2YTYqtmI2KfYtdmEINin2YTYp9is2KrZhdin2LnZiiDZh9mIINil2LnZhNin2YYg2KfZhNiq2LLYp9mF2KfZiyDY",
    "qNi22YjYp9io2Lcg2KfZhNil2LnZhNin2YbYp9iqINmB2Yog2KfZhNmF2YXZhNmD2Kkg2KfZhNi52LHYqNmK2Kkg2KfZhNiz",
    "2LnZiNiv2YrYqS4ifSx7InQiOiJoIiwidiI6Itiz2KfYqNi52KfZizog2KfZhNmG2LLYp9i52KfYqjoifSx7InQiOiJwIiwi",
    "diI6ItmB2Yog2K3Yp9mE2Kkg2YbYtNmI2KEg2YbYstin2Lkg2KjZitmGINin2YTYt9ix2YHZitmGIFwi2YTYpyDYs9mF2K0g",
    "2KfZhNmE2YdcIiDZitmE2KzYoyDZhNmF2K3Yp9mD2YUg2KfZhNmF2YXZhNmD2Kkg2KfZhNi52LHYqNmK2Kkg2KfZhNiz2LnZ",
    "iNiv2YrYqSDZhNmE2YHYtdmEINmB2Yog2YfYsNinINin2YTZhtiy2KfYuS4ifSx7InQiOiJjZW50ZXIiLCJ2Ijoi2KrZhSDY",
    "qtit2LHZitixINmH2LDYpyDYp9mE2LnZgtivINmF2YYg2YbYs9iu2KrZitmG2Iwg2YjYqtiz2YTZitmFINmD2YQg2LfYsdmB",
    "INmG2LPYrtipINmF2YbZhy4g2YjYudmE2YrZhyDYrNix2Ykg2KfZhNiq2YjZgtmK2Lk6In0seyJ0IjoiY2VudGVyIiwidiI6",
    "ItmI2KfZhNmE2Ycg2KfZhNmF2YjZgdmCLiJ9LHsidCI6InNpZyIsInJpZ2h0Ijoi2KfZhNi32LHZgSDYp9mE2KPZiNmEOiAg",
    "2KfYrdmF2K8g2YLYsdmG2YHZhNipIiwibGVmdCI6Itin2YTYt9ix2YEg2KfZhNir2KfZhtmKOiJ9XSwic3RyaW5ncyI6eyJt",
    "aXNzaW5nIjoi2LrZitixINmF2K/YrtmEIiwicGVuZGluZyI6ItmK2Y/Yttin2YEg2LnZhtivINin2YTYpdmG2LTYp9ihIiwi",
    "cml5YWwiOiLYsdmK2KfZhCDYs9i52YjYr9mKIiwiZGF5cyI6ItmK2YjZhSJ9fQ==",
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
