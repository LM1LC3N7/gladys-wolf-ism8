# Wolf ISM8 pour Gladys Assistant

Cette intégration affiche dans Gladys le chauffage Wolf relié à un module
**ISM8i** (ou ISM8) : chaudières gaz et fioul, pompes à chaleur, circuit
direct et circuits mélangés, module cascade, module solaire, ventilation CWL,
commande BM-2. Tout reste sur votre réseau local, sans cloud ni compte Wolf.

Intégration non officielle, sans lien avec Wolf. **Jamais testé avec un vrai
ISM8i** : elle suit la description de l’interface ISM8 publiée par Wolf et la
bibliothèque wolf_ism8 (MIT) de l’intégration Home Assistant. Vos retours
avec un vrai module sont les bienvenus.

## Ce que vous obtenez

Un appareil Gladys par élément Wolf que l’ISM8i signale, avec une
fonctionnalité par valeur reçue :

- températures (chaudière, départ, retour, eau chaude, extérieure, fumées,
  capteur solaire, ambiante…), en °C ;
- puissance des pompes à chaleur et du module solaire, en kW ;
- états (brûleur, pompes, vannes, défaut, sorties) en lecture seule ;
- états de fonctionnement et programmes en texte (jamais publiés comme une
  mesure 0), dernier code de défaut ;
- pourcentages (brûleur, modulation, ventilation), corrections de consigne
  (K), débits (l/h) et pression de l’installation (valeur brute telle que
  l’ISM8i l’envoie) en valeurs simples, l’unité dans le nom ;
- la consigne d’eau chaude et les programmes de chauffage et d’eau chaude du
  circuit direct et des circuits mélangés 1 à 3, modifiables (voir plus bas).

Un appareil apparaît dans l’onglet **Découverte** dès que l’ISM8i a envoyé une
de ses valeurs. Pas affichés dans cette version : dates et heures, compteurs
d’énergie du module solaire, débits d’air de la ventilation, champs de bits
de détection de la BM-2.

## Comment l’ISM8i joint Gladys

C’est l’ISM8i qui ouvre la connexion (TCP) vers le serveur indiqué dans sa
page web ; Gladys n’interroge pas le module. L’intégration lance donc un
petit récepteur à côté d’elle (le conteneur `ism8-link`) dont Gladys publie le
port sur la machine.

1. Donnez une adresse IP fixe à l’ISM8i dans votre box.
2. Dans l’écran **Configuration** de l’intégration, saisissez cette adresse
   et enregistrez. **Rien n’écoute avant** : le récepteur n’est lancé qu’une
   fois une adresse valide enregistrée, et arrêté si vous l’effacez.
3. Rechargez l’écran : la section « Comment l’ISM8i joint Gladys » affiche le
   port choisi par Gladys (un port libre, gardé ensuite). L’ISM8i utilise
   12004 par défaut : remplacez-le par ce port.
4. Dans la page web de l’ISM8i, indiquez comme adresse du serveur l’adresse IP
   de la machine Gladys sur votre réseau, et ce port.
5. L’état de l’intégration passe à « ISM8i connecté » dès la première
   connexion ; toutes les valeurs sont alors demandées au module.

### Le réseau : ce qui a été vérifié

Le cœur de Gladys tourne sur le **réseau hôte** de la machine
(`network_mode: host`), mais les intégrations tournent dans des conteneurs
isolés, sur un réseau Docker privé : elles ne peuvent pas écouter sur la
machine elles-mêmes. Le récepteur `ism8-link` est un sous-conteneur déclaré
dans le manifeste, dont Gladys publie le port TCP 12004 sur **toutes les
adresses de la machine** (`0.0.0.0:<port choisi>`). L’ISM8i joint donc
`<adresse IP de la machine Gladys>:<port affiché>`.

Vérifié dans un Gladys de test en Docker (2026-10-28) : rien n’écoute avant
l’enregistrement de l’adresse ; une fois enregistrée, le port est publié,
une connexion venue d’une autre adresse du réseau arrive avec **sa vraie
adresse source** (Docker la garde pour le trafic venu du réseau) et reçoit
l’accusé de réception et la demande de toutes les valeurs ; une connexion
partie de la machine Gladys elle-même arrive au contraire avec l’adresse de
la passerelle Docker.

Conséquences :

- si votre machine a un pare-feu, autorisez ce port en TCP ;
- l’option **Vérifier l’expéditeur** (activée par défaut) n’accepte que
  l’adresse de l’ISM8i ; une autre adresse est refusée avant tout octet lu,
  et l’état indique l’adresse vue. Sur Docker Desktop (Mac, Windows) ou
  Docker sans root, Docker peut remplacer l’adresse source : l’état montre alors
  des connexions refusées depuis une adresse interne ; désactivez l’option
  dans ce cas seulement (toute machine du réseau peut alors envoyer des
  valeurs à la place de l’ISM8i) ;
- par Gladys Plus ou un proxy, l’adresse affichée par le navigateur n’est pas
  celle que l’ISM8i doit joindre : utilisez l’adresse locale de la machine.
- quand l’intégration redémarre (mise à jour, redémarrage de Gladys), Gladys
  relance aussi le récepteur : la connexion de l’ISM8i est coupée, l’ISM8i se
  reconnecte de lui-même, et l’intégration retrouve le récepteur en 30 s
  environ (le temps que Docker oublie l’ancien conteneur).

## Modifier les réglages

Désactivé par défaut. Avec **Autoriser la modification des réglages** :

- **consigne d’eau chaude** : degrés entiers, de 20 °C au plafond de l’eau
  chaude (65 °C par défaut, réglable de 20 à 65 °C, jamais au-dessus de
  65 °C quoi qu’on saisisse) ; une valeur au-dessus est refusée, et le
  plafond est revérifié juste avant l’envoi ;
- **programme de chauffage** : automatique, chauffage (confort), éco, veille ;
- **programme d’eau chaude** : automatique, permanent, veille.

Une commande part seulement si l’option est active à son arrivée **et** juste
avant l’envoi, si l’ISM8i est connecté, et si la valeur actuelle a été reçue
pendant sa connexion en cours. Elle est dite appliquée seulement quand
l’ISM8i renvoie la nouvelle valeur ; sinon « envoyée, sans confirmation »,
et toutes les valeurs sont redemandées 5 et 20 s plus tard. Le résultat
s’affiche dans l’état de l’intégration.

Jamais écrits : puissances et températures imposées des chaudières, programmes
horaires, charge d’eau chaude ponctuelle, ventilation, et toute autre valeur.

### L’arrêt (programme veille) n’est jamais bloqué

Choisir **Veille** (arrêt, hors-gel conservé par la régulation Wolf) pour le
chauffage ou l’eau chaude d’un circuit est toujours accepté : option désactivée,
plafond, valeur pas encore lue, autre commande en cours, configuration pas
encore lue dans Gladys, rien ne le retient. Il est gardé dans `/data` et :

- part tout de suite si l’ISM8i est connecté ;
- sinon part dès la prochaine connexion de l’ISM8i (et, après un redémarrage
  de l’intégration, dès que le récepteur répond, avant même la lecture de la
  configuration) ;
- est renvoyé, espacé de 5 s, si une valeur lue le contredit avant d’avoir
  été confirmé, 3 envois au plus en tout ; au-delà, l’état demande de
  vérifier la chaudière.

Seuls cas où il ne part pas tout de suite : l’ISM8i n’est pas connecté, ou le
récepteur ne tourne pas (adresse pas encore enregistrée) ; il attend alors
dans `/data`. Une fois confirmé, il n’est plus jamais renvoyé : un programme
changé ensuite sur la chaudière ou dans l’application Wolf, lu deux fois de
suite, lève l’arrêt sans être combattu. Choisir un autre programme dans
Gladys (option active) le lève aussi. Le temps seul ne le lève jamais.

Tant qu’un arrêt d’un circuit n’est pas confirmé, tout autre changement de
ce circuit est refusé (sa consigne d’eau chaude, son autre programme) ;
choisir un autre programme pour celui qui est arrêté reste permis (cela lève
l’arrêt).

## Sécurité

- Le protocole ISM8 n’a **pas de mot de passe** et circule en clair : gardez l’ISM8i et
  Gladys sur un réseau de confiance.
- Le récepteur accepte 4 connexions au plus, une seule session ISM8 à la fois
  (une nouvelle connexion de l’ISM8i remplace l’ancienne), des trames de
  2048 octets et 300 valeurs au plus, vérifiées entières ; une trame mal
  formée, incomplète depuis 5 s ou un flot de plus de 400 trames en 10 s
  ferme la connexion.
- Le canal entre le récepteur et l’intégration passe par le réseau privé de
  l’intégration, avec une preuve mutuelle d’un secret généré par
  l’intégration.

## Bouton « Relire toutes les valeurs »

Demande à l’ISM8i connecté de renvoyer toutes ses valeurs (au plus toutes les
30 s). L’intégration le fait aussi à chaque connexion, toutes les 5 minutes
et après chaque commande.

## Dépannage

- **« En attente de l’ISM8i »** : vérifiez l’adresse du serveur et le port
  dans la page de l’ISM8i, le pare-feu de la machine Gladys, et que l’ISM8i
  est sur le même réseau.
- **« connexion(s) refusée(s) depuis … »** : l’adresse vue n’est pas celle
  saisie ; corrigez l’adresse, ou voir plus haut (Docker qui masque
  l’adresse).
- **Une valeur manque** : l’ISM8i n’envoie que ce que votre installation
  possède ; une valeur hors de sa plage plausible n’est jamais publiée.
- **Pression étrange** : la pression est publiée telle que l’ISM8i l’envoie ;
  son unité réelle reste à confirmer sur un vrai module.

## Crédits

Protocole et table des valeurs portés de
[wolf_ism8](https://github.com/marcschmiedchen/wolf_ism8) et
[home-assistant-wolf_ism8](https://github.com/marcschmiedchen/home-assistant-wolf_ism8)
de Marc Schmiedchen (licence MIT), voir `THIRD_PARTY_NOTICES.md`.
