/// <reference path="../pb_data/types.d.ts" />
// users.last_login — trvalé „kdy se naposledy přihlásil". Tabulka loginlogs
// se po 90 dnech promazává (retence), takže z ní nejde poznat, jestli se
// člověk VŮBEC KDY přihlásil. Správa organizace to potřebuje kvůli stavu
// „pozvánka čeká na přijetí" a mailer podle toho pozná pozvánku od resetu
// hesla (nikdy nepřihlášený účet nemá dostat „někdo vám mění heslo").
// users.invited_by — kdo účet založil pozvánkou (e-mail zvoucího). Prázdné =
// self-registrace. Rozlišuje pozvánkový mail od resetu hesla: heuristika
// „nikdy nepřihlášen" nestačí, reset pro čerstvě samoregistrovaný účet musí
// zůstat resetem (chytila to sada maily-jazyk).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new DateField({ name: "last_login" }));
  users.fields.add(new TextField({ name: "invited_by", max: 255 }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("last_login");
  users.fields.removeByName("invited_by");
  app.save(users);
});
