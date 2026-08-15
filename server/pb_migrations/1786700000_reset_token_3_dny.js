/// <reference path="../pb_data/types.d.ts" />
// Platnost odkazu na nastavení hesla: 30 minut → 3 dny (259200 s).
//
// Pozvánka do killBottlenecku jde přes `sendRecordPasswordReset`, takže sdílí
// token s běžnou obnovou hesla. Výchozích 30 minut PocketBase stačí na reset,
// ale pozvaný kolega otevírá mail klidně po dnech — a dostal jen generické
// „An error occurred while validating the submitted data." (beta, tenant tengo,
// 14. 8. 2026; tentýž vzorec už 11. 8.: tři neúspěchy, nová pozvánka kliknutá
// do 2 minut prošla). 3 dny schválil Richard 14. 8. 2026.
migrate((app) => {
  const col = app.findCollectionByNameOrId("users");
  col.passwordResetToken.duration = 259200;
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("users");
  col.passwordResetToken.duration = 1800;
  app.save(col);
});
