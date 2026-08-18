/// <reference path="../pb_data/types.d.ts" />
// users.welcome_sent — TVRDÁ závora proti dvojímu odeslání uvítacího mailu.
//
// Proč vlastní pole a ne „je to první přihlášení?": ta heuristika prokazatelně
// selhává. Frontend při prvním přihlášení PATCHuje `users` ve stejné milisekundě,
// v jaké hook zapisuje `last_login`, a přepíše ji prázdnou hodnotou — druhé
// přihlášení tedy vidí „poprvé" znovu (ostrý provoz 9. 8. 2026: notifikaci
// o vstupu dostal zvoucí u 3 ze 3 pozvaných DVAKRÁT). Uvítací mail se posílá
// jednou za život účtu, takže potřebuje příznak, který PATCH nesahá — frontend
// tohle pole nikdy neposílá.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new BoolField({ name: "welcome_sent" }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("welcome_sent");
  app.save(users);
});
