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

  var SHA256 = "7d099557ebcbeebc5c0d13dbcc319e85384e94b8f6982dc88cc2bbc47e963454";

  var CHUNKS = [
    "eyJrZXkiOiIiLCJsYWJlbCI6IlJhd2FkIGFsdGF0aGlyIFVHQyIsImJsb2NrcyI6W3sidCI6ImlkIiwidiI6Int7IGlkIH19In0s",
    "eyJ0IjoidGl0bGUiLCJ2IjoiXCIg2LnZgtivINiq2LPZiNmK2YIg2KfZhNmD2KrYsdmI2YbZilwiIn0seyJ0IjoicCIsInYiOiLY",
    "p9mE2K3ZhdivINmE2YTZhyDZiNit2K/ZhyDZiNin2YXYpyDYqNi52K86In0seyJ0IjoicCIsInYiOiLYo9mG2Ycg2YHZiiDYqtin",
    "2LHZitiuIHt7IGRhdGUgfX0g2YUuINin2YTZhdmI2KfZgdmCIHt7IGRheSB9fSDYrdix2LEg2YfYsNinINin2YTYudmC2K8gKNmK",
    "2LTYp9ixINin2YTZitmHIFwi2KjYp9mE2LnZgtivXCIpINio2YrZhiDZg9mEINmF2YY6In0seyJ0IjoicCIsInYiOiLYp9mE2LfY",
    "sdmBINin2YTYo9mI2YQgOiDYtNix2YPYqSDYsdmI2KfYryDYp9mE2KrYo9ir2YrYsSAsINiz2KzZhCDYqtis2KfYsdmKINix2YLZ",
    "hSAoIDQwMzAzODE0NzIpICwg2KfZhNix2YLZhSDYp9mE2YjYt9mG2Yog2KfZhNmF2YjYrdivICggNzAxNzIyOTIzMykgLCDYp9mE",
    "2LHZgtmFINin2YTYttix2YrYqNmKICggMzE0ODk5OTI4NzAwMDAzKSAsINin2YTYudmG2YjYp9mGIDog2KfZhNmF2YXZhNmD2Kkg",
    "2KfZhNi52LHYqNmK2Kkg2KfZhNiz2LnZiNiv2YrYqSAsINis2K/YqSAsINit2Yog2KfZhNmB2YrYtdmE2YrYqSDYt9ix2YrZgiDY",
    "p9mE2YXYr9mK2YbYqSDYp9mE2YXZhtmI2LHYqSDZgdix2LnZiiAsINin2YTYsdmF2LIg2KfZhNio2LHZitiv2YogKCAyMzQ0Mikg",
    "LCDZiCDZitmF2KvZhNmH2Kcg2KfZhNij2LPYqtin2LAgLyDYp9it2YXYryDZgtix2YbZgdmE2Kkg2KjYtdmB2KrZhyDYp9mE2YXY",
    "r9mK2LEg2KfZhNi52KfZhS4ifSx7InQiOiJwIiwidiI6Itin2YTYt9ix2YEg2KfZhNir2KfZhtmKOiB7eyBsaWNlbnNlX25hbWUg",
    "fX0g4oCTINix2YLZhSDYp9mE2KrYsdiu2YrYtSDYp9mE2KXYudmE2KfZhdmKICgge3sgbGljZW5zZV9udW1iZXIgfX0gKSJ9LHsi",
    "dCI6InAiLCJ2Ijoi2KrZhdmH2YrYrzog2K3ZitirINij2YYg2KfZhNi32LHZgSDYp9mE2KfZiNmEINi02LHZg9ipINmG2LTYp9i3",
    "2YfYpyDYqtmC2K/ZitmFINiu2K/Zhdin2Kog2KrYs9mI2YrZgtmK2Kkg2YjYr9i52KfZitipINmI2KXYudmE2KfZhiDZhtmK2KfY",
    "qNip2Ysg2LnZhiDYp9mE2LrZitixINiMINmI2KfZhNi32LHZgSDYp9mE2KvYp9mG2Yog2YXYudmE2YYg2YHZiiDZhdmI2KfZgti5",
    "INin2YTYqtmI2KfYtdmEINin2YTYp9is2KrZhdin2LnZii4g2YjZitix2LrYqCDYp9mE2LfYsdmBINin2YTYo9mI2YQg2KjYp9mE",
    "2KfYqtmB2KfZgiDZhdi5INin2YTYt9ix2YEg2KfZhNir2KfZhtmKINmB2YrZhdinINmK2K7YtSDYr9i52KfZitipINmI2KfYudmE",
    "2KfZhi4ifSx7InQiOiJoIiwidiI6Itij2YjZhNmL2Kc6INmK2LnYqtio2LEg2KfZhNiq2YXZh9mK2K8g2KzYstih2YvYpyDZhNin",
    "INmK2KrYrNiy2KMg2YXZhiDZh9iw2Kcg2KfZhNi52YLYrzoifSx7InQiOiJwIiwidiI6Itin2YTZhdmG2KrYrNin2Kog2KfZhNiq",
    "2Yog2YrYqtmFINiq2LHZiNmK2KzZh9inOiB7eyBicmFuZF9uYW1lIH19In0seyJ0IjoiaCIsInYiOiLYq9in2YbZitmL2Kc6INmF",
    "2YjYttmI2Lkg2KfZhNi52YLYrzoifSx7InQiOiJwIiwidiI6Itio2YXZiNis2Kgg2YfYsNinINin2YTYudmC2K8g2KfYqtmB2YIg",
    "2KfZhNi32LHZgdin2YYg2KfZhiDZitmC2YjZhSDYp9mE2LfYsdmBINin2YTYp9mI2YQg2KjYrdis2LIg2K7Yr9mF2KfYqiDYudmE",
    "2Ykg2YXZiNin2YLYuSDYp9mE2KrZiNin2LXZhCDYp9mE2KfYrNiq2YXYp9i52Yog2LnZhNmJINin2YTZhtit2Ygg2KfZhNiq2KfZ",
    "hNmKINmF2Lk6In0seyJ0IjoidGFibGUiLCJyb3dzIjpbWyLYp9mE2YXYpNir2LEiLCLYp9mE2YXZhti12KkiLCLYrdiz2KfYqNmH",
    "INmB2Yog2KfZhNmF2YbYtdipIiwi2YbZiNi5INin2YTYpdi52YTYp9mGIl0sWyJ7eyBuYW1lXzIgfX0iLCJ7eyBwbGF0Zm9ybV9z",
    "bWFydCB9fSIsInt7IGNoYW5uZWxfbmFtZSB9fSIsInt7IGFkX3R5cGVzIH19Il1dfSx7InQiOiJoIiwidiI6Itir2KfZhNir2YvY",
    "pzog2KfZhNiv2YHYuToifSx7InQiOiJwIiwidiI6Itin2YYg2YrYs9iv2K8g2KfZhNi32LHZgSDYp9mE2KfZiNmEINmE2YAg2KfZ",
    "hNi32LHZgSDYp9mE2KvYp9mG2Yog2YXYqNmE2Log2KfZhNil2LnZhNin2YYg2YjZgtiv2LHZhyB7eyBBbW91bnRfZnVsbCB9fSDY",
    "utmK2LEg2LTYp9mF2YTYqSDYp9mE2LbYsdmK2KjYqdiMINmI2LDZhNmDINi52YYg2LfYsdmK2YIg2KfZhNiq2K3ZiNmK2YQg2KfZ",
    "hNmF2LXYsdmB2Yog2YTZhNit2LPYp9ioINin2YTYqNmG2YPZii4g2YjYs9iq2YPZiNmGINin2YTYrdmI2KfZhNipINmC2KjZhCDZ",
    "hti02LEg2KfZhNil2LnZhNin2YYuIn0seyJ0IjoicCIsInYiOiLZitmC2LEg2KfZhNi32LHZgSDYp9mE2KvYp9mG2Yog2KjYtdit",
    "2Kkg2KfZhNio2YrYp9mG2KfYqiDYp9mE2KjZhtmD2YrYqSDYp9mE2YXYsdiz2YTYqSDZhdmGINmC2KjZhNmHINiz2YjYp9ihINmD",
    "2KfZhtiqINio2KfYs9mF2Ycg2KfZiCDYqNin2LPZhSDYt9ix2YEg2KvYp9mE2KsgLCDZiCDZitiq2K3ZhdmEINin2YTYt9ix2YEg",
    "2KfZhNir2KfZhtmKINmD2KfZhdmEINin2YTZhdiz2KTZiNmE2YrYqSDYudmGINin2K7YqtmK2KfYsSDYp9mE2K3Ys9in2Kgg2KfZ",
    "hNio2YbZg9mKICwg2Ygg2KjYp9mE2KrYp9mE2Yog2YrYudivINij2Yog2KrYrdmI2YrZhCDZitiq2YUg2KfYqNix2KfYodmLINmE",
    "2LDZhdipINin2YTYt9ix2YEg2KfZhNij2YjZhC4ifSx7InQiOiJwIiwidiI6Itiz2YrYqtmFINiq2K3ZiNmK2YQg2KfZhNmF2KjZ",
    "hNi6INi52KjYsSBcItit2YjYp9mE2Kkg2KjZhtmD2YrYqVwiINio2KfZhNmF2LnZhNmI2YXYp9iqINin2YTYqtin2YTZitipOiJ9",
    "LHsidCI6Imt2IiwidiI6Itin2LPZhSDYp9mE2KjZhtmDOiB7eyBiYW5rX25hbWUgfX0ifSx7InQiOiJrdiIsInYiOiLYp9iz2YUg",
    "2KfZhNit2LPYp9ioOiDigI4ge3sgYWNjb3VudF9uYW1lIH19In0seyJ0Ijoia3YiLCJ2Ijoi2LHZgtmFINin2YTYrdiz2KfYqCA6",
    "IHt7IGFjY291bnRfbnVtYmVyIH19In0seyJ0Ijoia3YiLCJ2Ijoi2LHZgtmFINin2YTYp9mK2KjYp9mGIDoge3sgaWJhbiB9fSJ9",
    "LHsidCI6ImgiLCJ2Ijoi2LHYp9io2LnYp9mLOiDYtNix2Ygg2Lcg2YjYo9it2YPYp9mFOiJ9LHsidCI6ImxpIiwidiI6Ii3Yp9mE",
    "2KfZhNiq2LLYp9mFINio2KfZhNiq2YjYp9ix2YrYriDYp9mE2YXYqtmB2YIg2LnZhNmK2YfYpyDZiNiq2LfYqNmK2YIg2KfZhNmF",
    "2K3YqtmI2Ykg2YPYp9mF2YTYp9mLINmD2YXYpyDZh9mIINmF2LfZhNmI2Kgg2YXZhiDZgtio2YQg2KfZhNi52YXZitmEINmI2KfZ",
    "hiDZitiq2YUg2YXYtNin2LHZg9ipINin2YTZhdit2KrZiNmJINmC2KjZhCDZhti02LHZhyDZhNmE2KrYo9mD2YrYryDYudmE2YrZ",
    "hyDZhdmGINmC2KjZhCDYp9mE2LnZhdmK2YQuIn0seyJ0IjoibGkiLCJ2IjoiLdmK2YLYsSBcItin2YTYt9ix2YEg2KfZhNir2KfZ",
    "htmKXCIg2Ygg2YrZhNiq2LLZhSDYqNij2YYg2YTYr9mK2Ycg2KzZhdmK2Lkg2KfZhNiq2LHYp9iu2YrYtSDYp9mE2YTYp9iy2YXY",
    "qSDZhNmF2YXYp9ix2LPYqSDYp9mE2K/Yudin2YrYqSDZiCDYp9mE2KXYudmE2KfZhiDZiNmB2YLZi9inINmE2YTYo9mG2LjZhdip",
    "INin2YTZhdi52YXZiNmEINio2YfYpywg2Ygg2YrYqtit2YXZhCDZiNit2K/ZhyDZg9in2YXZhCDYp9mE2YXYs9ik2YjZhNmK2Kkg",
    "2LnZhiDYo9mKINmF2K7Yp9mE2YHYqSDYp9mIINi62LHYp9mF2Kkg2KfZiCDYttix2LEg2YrZhti02KMg2LnZhiDYudiv2YUg2KfZ",
    "hNin2YTYqtiy2KfZhSDYqNiw2YTZgywg2YXYuSDYp9i52YHYp9ihIFwi2KfZhNi32LHZgSDYp9mE2KPZiNmEXCIg2YXZhiDYo9mK",
    "INmF2LPYpNmI2YTZitipINio2YfYsNinINin2YTYtNij2YYuIn0seyJ0IjoibGkiLCJ2IjoiLSDYp9mE2LTYsdmI2Lcg2KfZhNio",
    "2KfYt9mE2Kk6INil2YYg2KjYt9mE2KfZhiDYo9mKINio2YbYryDZhdmGINio2YbZiNivINmH2LDYpyBcItin2YTYudmC2K9cIiDZ",
    "hNinINmK2KTYq9ixINi52YTZiSDYqNmC2YrYqSDYqNmG2YjYryBcItin2YTYudmC2K9cIiDYp9mE2KrZiiDYqti42YQg2LPYp9ix",
    "2YrYqSDZiNmF2YbYqtis2Kkg2YTYo9ir2KfYsdmH2Kcg2KjZitmGIFwi2KfZhNi32LHZgdmK2YZcIi4g2KfZhNinINin2LDYpyDY",
    "qtio2YrZhiDYp9mGINin2K3YryDYp9mE2YXYqti52KfZgtiv2YrZhiDZhdinINmD2KfZhiDZhNmK2LHYttmJINio2KfZhNi52YLY",
    "ryDYr9mI2YYg2LDZhNmDINin2YTYqNmG2K8g2YHZhNmHINit2YIg2LfZhNioINin2KjYt9in2YQg2KfZhNi52YLYry4ifSx7InQi",
    "OiJsaSIsInYiOiItINmK2KzYqCDYp9ix2LPYp9mEINil2K3Ytdin2KHYp9iqINin2YTYpdi52YTYp9mGINio2LnYryDZhtiy2YjZ",
    "hNmHOiJ9LHsidCI6ImxpIiwidiI6Ii0g2KXYrdi12KfYodin2KogXCIg2KrZitmDINiq2YjZg1wiICwgXCIg2KfZhtiz2KrZgtix",
    "2KfZhSDYqNmI2LPYqiDZiCDYsdmK2YrZhFwiICwg2YTYpyDYqtiq2KzYp9mI2LIgNyDYo9mK2KfZhSDZhdmGINiq2KfYsdmK2K4g",
    "2YbYstmI2YQg2KfZhNil2LnZhNin2YYuIn0seyJ0IjoibGkiLCJ2IjoiLSDYpdit2LXYp9ih2KfYqiBcIiDYp9mG2LPYqtmC2LHY",
    "p9mFINmIINiz2YbYp9ioINiq2LTYp9iqINiz2KrZiNix2YpcIiDZhNinINiq2KrYrNin2YjYsiAyNCDYs9in2LnYqSDZhdmGINiq",
    "2KfYsdmK2K4g2YbYstmI2YQg2KfZhNil2LnZhNin2YYuIn0seyJ0IjoiaCIsInYiOiLYrtin2YXYs9in2Ys6INil2YbZh9in2KEg",
    "2KfZhNi52YLYryDYp9mIINi32YTYqCDYqti62YrZitixINmB2Yog2YXZiNi22YjYuSDYp9mE2LnZgtivOiJ9LHsidCI6InAiLCJ2",
    "Ijoi2YHZiiDYrdin2YQg2LHYutioIFwi2KfZhNi32LHZgSDYp9mE2KvYp9mG2YpcIiDZgdmKINin2YbZh9in2KEg2KfZhNi52YLY",
    "ryDZiCDZitmI2KzYryDZhdmG2KrYrNin2Kog2YXYsdiz2YTYqSDZhdmGINmC2KjZhCBcItin2YTYt9ix2YEg2KfZhNij2YjZhFwi",
    "INmK2YTYqtiy2YUgXCLYp9mE2LfYsdmBINin2YTYq9in2YbZilwiINmB2Yog2KfYsdis2KfYudmH2Kcg2YXYuSDYqtit2YXZhCDZ",
    "gtmK2YXYqSDYp9mE2KfYsdis2KfYuSDYp9mGINmI2KzYr9iqLiJ9LHsidCI6InAiLCJ2Ijoi2YHZiiDYrdin2YQg2LHYutioIFwi",
    "2KfZhNi32LHZgSDYp9mE2KvYp9mG2YpcIiDZgdmKINin2YbZh9in2KEg2KfZhNi52YLYryDZiCDZitmI2KzYryDZhdio2KfZhNi6",
    "INiq2YUg2K/Zgdi52YfYpyBcItmE2YTYt9ix2YEg2KfZhNir2KfZhtmKXCIg2YXZhiDZgtio2YQgXCLYp9mE2LfYsdmBINin2YTY",
    "o9mI2YRcIiDZitmE2KrYstmFIFwi2KfZhNi32LHZgSDYp9mE2KvYp9mG2YpcIiDZgdmKINin2LHYrNin2LnZh9inLiJ9LHsidCI6",
    "InAiLCJ2Ijoi2YTYpyDZitmF2YPZhiBcIiDZhNmE2LfYsdmBINin2YTYq9in2YbZilwiINi32YTYqCDYqtmC2YTZitmEINi52K/Y",
    "ryDYp9mE2K7Yr9mF2KfYqiDYp9mE2YXYqtmB2YIg2LnZhNmK2YfYpyDZgdmKIFwiINmF2YjYttmI2Lkg2KfZhNi52YLYryBcIi4g",
    "2K3ZitirINin2YYg2KfZhNij2LPYudin2LEg2KfZhNmF2LnYt9in2Kkg2YXYsdiq2KjYt9ipINin2LHYqtio2KfYtyDZg9mE2Yog",
    "2KjYudiv2K8g2KfZhNiu2K/Zhdin2Kog2KfZhNmD2YXZii4ifSx7InQiOiJwIiwidiI6ItmK2KrZhSDYp9ix2KzYp9i5INin2YTZ",
    "hdio2KfZhNi6INi52YYg2LfYsdmK2YIg2KfZhNiq2K3ZiNmK2YQg2KfZhNio2YbZg9mKINi52YTZiSDYrdiz2KfYqCDYp9mE2LTY",
    "sdmD2Kkg2KjYp9mE2YXYudmE2YjZhdin2Kog2KfZhNiq2KfZhNmK2Kk6In0seyJ0Ijoia3YiLCJ2Ijoi2KfZhNio2YbZgyA6INin",
    "2YTYp9mG2YXYp9ihIn0seyJ0Ijoia3YiLCJ2Ijoi2KfYs9mFINin2YTYrdiz2KfYqDog2LTYsdmD2Kkg2LHZiNin2K8g2KfZhNiq",
    "2KPYq9mK2LEifSx7InQiOiJrdiIsInYiOiLYsdmC2YUg2KfZhNit2LPYp9ioIDogNjgyMDI3MDc4MjQwMDAifSx7InQiOiJrdiIs",
    "InYiOiLYsdmC2YUg2KfZhNin2YrYqNin2YY6IFNBODUwNTAwMDA2ODIwMjcwNzgyNDAwMCJ9LHsidCI6ImgiLCJ2Ijoi2LPYp9iv",
    "2LPYp9mLOiDYp9mE2KXYrti32KfYsSDZiNin2YTZhdix2KfYs9mE2KfYqjoifSx7InQiOiJwIiwidiI6Itiq2LnYqtio2LEg2KfZ",
    "hNmF2YjYp9mB2YLYqSDYp9mE2KXZhNmD2KrYsdmI2YbZitipINmD2KfZgdmK2Kkg2YHZiiDYrdiv2YjYqyDYo9mKINil2LTYudin",
    "2LEg2LHYs9mF2Yog2KjZitmGINmD2YQg2YXZhiDYp9mE2LfYsdmB2YrZhtiMINmI2LDZhNmDINmK2KrYttmF2YYg2KfZhNio2LHZ",
    "itivINin2YTYpdmE2YPYqtix2YjZhtmK2Iwg2YjYp9mE2LHYs9in2KbZhCDYp9mE2YbYtdmK2KnYjCDZiNin2YTYsdiz2KfYptmE",
    "INmF2YYg2K7ZhNin2YQg2KrYt9io2YrZgiDYp9mE2YjYp9iq2LPYp9io2Iwg2KPZiCDYo9mKINmI2LPZitmE2Kkg2KfYqti12KfZ",
    "hCDYrdiv2YrYq9ipLiDZg9mF2Kcg2YrYrNioINij2YYg2YrZg9mI2YYg2KfZhNix2K8g2K7ZhNin2YQg2YXYr9ipINij2YLYtdin",
    "2YfYpyDZitmI2YXZitmGINmF2YYg2KrYp9ix2YrYriDYp9mE2KXYsdiz2KfZhCDZiNmK2YTYqtiy2YUg2KfZhNi32LHZgdin2YYg",
    "2KjYqNmK2KfZhiDYo9mGINin2YTZhdit2KrZiNmJINin2YTYsNmKINmK2KrZhSDYqti12YjZitix2Ycg2YXZhiDZgtio2YQg2YXY",
    "pNir2LEg2KfZhNiq2YjYp9i12YQg2KfZhNin2KzYqtmF2KfYudmKINmH2Ygg2KXYudmE2KfZhiDYp9mE2KrYstin2YXYp9mLINio",
    "2LbZiNin2KjYtyDYp9mE2KXYudmE2KfZhtin2Kog2YHZiiDYp9mE2YXZhdmE2YPYqSDYp9mE2LnYsdio2YrYqSDYp9mE2LPYudmI",
    "2K/ZitipLiJ9LHsidCI6ImgiLCJ2Ijoi2LPYp9io2LnYp9mLOiDYp9mE2YbYstin2LnYp9iqOiJ9LHsidCI6InAiLCJ2Ijoi2YHZ",
    "iiDYrdin2YTYqSDZhti02YjYoSDZhtiy2KfYuSDYqNmK2YYg2KfZhNi32LHZgdmK2YYgXCLZhNinINiz2YXYrSDYp9mE2YTZh1wi",
    "INmK2YTYrNijINmE2YXYrdin2YPZhSDYp9mE2YXZhdmE2YPYqSDYp9mE2LnYsdio2YrYqSDYp9mE2LPYudmI2K/ZitipINmB2Yog",
    "2YXYr9mK2YbYqSDYrNiv2Kkg2YTZhNmB2LXZhCDZgdmKINmH2LDYpyDYp9mE2YbYstin2LkuIn0seyJ0IjoiY2VudGVyIiwidiI6",
    "Itiq2YUg2KrYrdix2YrYsSDZh9iw2Kcg2KfZhNi52YLYryDZhdmGINmG2LPYrtiq2YrZhtiMINmI2KrYs9mE2YrZhSDZg9mEINi3",
    "2LHZgSDZhtiz2K7YqSDZhdmG2YcuINmI2LnZhNmK2Ycg2KzYsdmJINin2YTYqtmI2YLZiti5OiJ9LHsidCI6ImNlbnRlciIsInYi",
    "OiLZiNin2YTZhNmHINin2YTZhdmI2YHZgi4ifSx7InQiOiJzaWciLCJyaWdodCI6Itin2YTYt9ix2YEg2KfZhNij2YjZhDogINin",
    "2K3ZhdivINmC2LHZhtmB2YTYqSIsImxlZnQiOiLYp9mE2LfYsdmBINin2YTYq9in2YbZijoifV0sInN0cmluZ3MiOnsibWlzc2lu",
    "ZyI6Iti62YrYsSDZhdiv2K7ZhCIsInBlbmRpbmciOiLZitmP2LbYp9mBINi52YbYryDYp9mE2KXZhti02KfYoSIsInJpeWFsIjoi",
    "2LHZitin2YQg2LPYudmI2K/ZiiIsImRheXMiOiLZitmI2YUifX0="
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
