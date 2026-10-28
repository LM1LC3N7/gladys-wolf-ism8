// -----------------------------------------------------------------------------
// Texts in English and French: device and datapoint names (keyed by the
// German names of the Wolf table, src/ism8/table.js), program names, the
// status and the answers of the buttons.
// -----------------------------------------------------------------------------

export const word = (text, language) => (language === 'en' ? text.en : text.fr);
const t = (en, fr) => Object.freeze({ en, fr });

export const DEVICE_PREFIX = 'Wolf';

export const GROUP_NAMES = Object.freeze({
  'appliance-1': t('heating appliance 1', 'appareil de chauffage 1'),
  'appliance-2': t('heating appliance 2', 'appareil de chauffage 2'),
  'appliance-3': t('heating appliance 3', 'appareil de chauffage 3'),
  'appliance-4': t('heating appliance 4', 'appareil de chauffage 4'),
  system: t('system control module', 'module de commande système'),
  'direct-circuit': t('direct heating circuit and hot water', 'circuit direct et eau chaude'),
  'mixer-circuit-1': t('mixer circuit 1', 'circuit mélangé 1'),
  'mixer-circuit-2': t('mixer circuit 2', 'circuit mélangé 2'),
  'mixer-circuit-3': t('mixer circuit 3', 'circuit mélangé 3'),
  cascade: t('cascade module', 'module cascade'),
  'mixer-module-1': t('mixer module 1', 'module mélangeur 1'),
  'mixer-module-2': t('mixer module 2', 'module mélangeur 2'),
  'mixer-module-3': t('mixer module 3', 'module mélangeur 3'),
  solar: t('solar module', 'module solaire'),
  ventilation: t('CWL ventilation', 'ventilation CWL'),
  'heat-pump-1': t('heat pump 1', 'pompe à chaleur 1'),
  'heat-pump-2': t('heat pump 2', 'pompe à chaleur 2'),
  'heat-pump-3': t('heat pump 3', 'pompe à chaleur 3'),
  'heat-pump-4': t('heat pump 4', 'pompe à chaleur 4'),
  bm2: t('BM-2 control unit', 'commande BM-2'),
});

/** Datapoint names, keyed by the German name of the Wolf table. */
export const DP_NAMES = Object.freeze({
  Stoerung: t('Fault', 'Défaut'),
  Betriebsart: t('Operating state', 'État de fonctionnement'),
  Brennerleistung: t('Burner output (%)', 'Puissance du brûleur (%)'),
  Kesseltemperatur: t('Boiler temperature', 'Température chaudière'),
  Sammlertemperatur: t('Header temperature', 'Température collecteur'),
  Ruecklauftemperatur: t('Return temperature', 'Température de retour'),
  Warmwassertemperatur: t('Hot water temperature', 'Température eau chaude'),
  Aussentemperatur: t('Outdoor temperature', 'Température extérieure'),
  'Status Brenner': t('Burner', 'Brûleur'),
  'Status Heizkreispumpe': t('Heating circuit pump', 'Pompe du circuit de chauffage'),
  'Status Speicherladepumpe': t('Tank charging pump', 'Pompe de charge du ballon'),
  'Status 3W-Umschaltventil': t('Three-way valve', 'Vanne trois voies'),
  Anlagendruck: t('System pressure', 'Pression de l’installation'),
  Raumtemperatur: t('Room temperature', 'Température ambiante'),
  Warmwassersolltemperatur: t('Hot water setpoint', 'Consigne eau chaude'),
  'Programmwahl Heizkreis': t('Heating program', 'Programme de chauffage'),
  'Programmwahl Warmwasser': t('Hot water program', 'Programme eau chaude'),
  'Programmwahl Mischer': t('Heating program', 'Programme de chauffage'),
  'Heizkreis Zeitprogramm 1': t('Heating time program 1', 'Programme horaire chauffage 1'),
  'Heizkreis Zeitprogramm 2': t('Heating time program 2', 'Programme horaire chauffage 2'),
  'Heizkreis Zeitprogramm 3': t('Heating time program 3', 'Programme horaire chauffage 3'),
  'Mischer Zeitprogramm 1': t('Heating time program 1', 'Programme horaire chauffage 1'),
  'Mischer Zeitprogramm 2': t('Heating time program 2', 'Programme horaire chauffage 2'),
  'Mischer Zeitprogramm 3': t('Heating time program 3', 'Programme horaire chauffage 3'),
  'Warmwasser Zeitprogramm 1': t('Hot water time program 1', 'Programme horaire eau chaude 1'),
  'Warmwasser Zeitprogramm 2': t('Hot water time program 2', 'Programme horaire eau chaude 2'),
  'Warmwasser Zeitprogramm 3': t('Hot water time program 3', 'Programme horaire eau chaude 3'),
  Sollwertkorrektur: t('Setpoint correction (K)', 'Correction de consigne (K)'),
  Sparfaktor: t('Eco factor (K)', 'Facteur éco (K)'),
  Gesamtmodulationsgrad: t('Total modulation (%)', 'Modulation totale (%)'),
  'Vorlauftemperatur Mischer': t('Mixer flow temperature', 'Température de départ mélangeur'),
  'Status Mischerkreispumpe': t('Mixer circuit pump', 'Pompe du circuit mélangé'),
  'Status Ausgang A1': t('Output A1', 'Sortie A1'),
  'Status Ausgang A2': t('Output A2', 'Sortie A2'),
  'Status Ausgang A3': t('Output A3', 'Sortie A3'),
  'Status Ausgang A4': t('Output A4', 'Sortie A4'),
  'Eingang E1': t('Input E1', 'Entrée E1'),
  'Eingang E2': t('Input E2', 'Entrée E2'),
  'Eingang E3': t('Input E3', 'Entrée E3'),
  'Warmwassertemperatur Solar 1': t(
    'Solar hot water temperature',
    'Température eau chaude solaire',
  ),
  'Temperatur Kollektor 1': t('Collector temperature', 'Température capteur solaire'),
  'Eingang E2 (Durchfluss)': t('Input E2, flow (l/h)', 'Entrée E2, débit (l/h)'),
  'Status Solarkreispumpe SKP1': t('Solar circuit pump', 'Pompe du circuit solaire'),
  Durchfluss: t('Flow (l/h)', 'Débit (l/h)'),
  'aktuelle Leistung': t('Current power', 'Puissance actuelle'),
  Programm: t('Ventilation program', 'Programme de ventilation'),
  'Zeitprogramm 1': t('Time program 1', 'Programme horaire 1'),
  'Zeitprogramm 2': t('Time program 2', 'Programme horaire 2'),
  'Zeitprogramm 3': t('Time program 3', 'Programme horaire 3'),
  'Intensivlueftung AN_AUS': t('Intensive ventilation', 'Ventilation intensive'),
  'Feuchteschutz AN_AUS': t('Humidity protection', 'Protection humidité'),
  Lueftungsstufe: t('Ventilation level (%)', 'Niveau de ventilation (%)'),
  Ablufttemperatur: t('Exhaust air temperature', 'Température air extrait'),
  Frischlufttemperatur: t('Fresh air temperature', 'Température air neuf'),
  'Bypass Initialisierung': t('Bypass initialising', 'Bypass en initialisation'),
  'Bypass offen': t('Bypass open', 'Bypass ouvert'),
  'Bypass geschlossen': t('Bypass closed', 'Bypass fermé'),
  'Bypass Fehler': t('Bypass fault', 'Défaut bypass'),
  'Frost Status: Init_Warte': t('Frost: waiting', 'Gel : en attente'),
  'Frost Status: Kein Frost': t('Frost: none', 'Gel : aucun'),
  'Frost Status: Vorwaermer': t('Frost: preheater', 'Gel : préchauffage'),
  'Frost Status: Fehler': t('Frost: fault', 'Gel : défaut'),
  Heizleistung: t('Heating power', 'Puissance de chauffage'),
  Kuehlleistung: t('Cooling power', 'Puissance de refroidissement'),
  'Status Aux-Pumpe': t('Auxiliary pump', 'Pompe auxiliaire'),
  '3W-Umschaltventil HZ_WW': t(
    'Three-way valve heating/hot water',
    'Vanne trois voies chauffage/eau chaude',
  ),
  '3W-Umschaltventil HZ_K': t(
    'Three-way valve heating/cooling',
    'Vanne trois voies chauffage/froid',
  ),
  'Status E-Heizung': t('Electric heater', 'Résistance électrique'),
  Leistungsaufnahme: t('Power input', 'Puissance absorbée'),
  'Filterwarnung aktiv': t('Filter warning', 'Alerte filtre'),
  'Filterwarnung zuruecksetzen': t('Filter warning reset', 'Remise à zéro alerte filtre'),
  '1x Warmwasserladung (global)': t('One-off hot water charge', 'Charge d’eau chaude ponctuelle'),
  Abgastemperatur: t('Flue gas temperature', 'Température des fumées'),
  Leistungsvorgabe: t('Power preset (%)', 'Puissance imposée (%)'),
  Kesseltemperaturvorgabe: t('Boiler temperature preset', 'Température chaudière imposée'),
  Gesamtmodulationsgradvorgabe: t('Total modulation preset (%)', 'Modulation totale imposée (%)'),
  Sammlertemperaturvorgabe: t('Header temperature preset', 'Température collecteur imposée'),
  'Betriebsart Heizen/Kuehlen': t('Cooling mode', 'Mode refroidissement'),
  Unterscheidung_Typ_HG1: t('Type of appliance 1', 'Type d’appareil 1'),
  Unterscheidung_Typ_HG2: t('Type of appliance 2', 'Type d’appareil 2'),
  Unterscheidung_Typ_HG3: t('Type of appliance 3', 'Type d’appareil 3'),
  Unterscheidung_Typ_HG4: t('Type of appliance 4', 'Type d’appareil 4'),
  Kesselsolltemperatur: t('Boiler target temperature', 'Température chaudière visée'),
  'Vorlaufsolltemperatur HK': t('Flow target temperature', 'Température de départ visée'),
  Mischersolltemperatur: t('Mixer target temperature', 'Température mélangeur visée'),
  'Letzter Stoercode': t('Last fault code', 'Dernier code de défaut'),
});

/** Program and state names, by key (src/ism8/datapoints.js). */
export const MODE_NAMES = Object.freeze({
  auto: t('Automatic', 'Automatique'),
  comfort: t('Heating (comfort)', 'Chauffage (confort)'),
  standby: t('Standby (off, frost protection)', 'Veille (arrêt, hors-gel)'),
  eco: t('Eco', 'Éco'),
  'frost-protection': t('Frost protection', 'Hors-gel'),
  cooling: t('Cooling', 'Refroidissement'),
  'auto-heating': t('Automatic heating', 'Chauffage automatique'),
  'auto-cooling': t('Automatic cooling', 'Refroidissement automatique'),
  legionella: t('Legionella protection', 'Anti-légionelle'),
  continuous: t('Continuous', 'Permanent'),
  reduced: t('Reduced', 'Réduit'),
  heating: t('Heating', 'Chauffage'),
  preheating: t('Preheating', 'Préchauffage'),
  'night-purge': t('Night purge', 'Rafraîchissement nocturne'),
  precool: t('Precooling', 'Pré-refroidissement'),
  test: t('Test', 'Test'),
  'emergency-heat': t('Emergency heating', 'Chauffage de secours'),
  'fan-only': t('Fan only', 'Ventilation seule'),
  'free-cool': t('Free cooling', 'Rafraîchissement gratuit'),
  'maximum-heating': t('Maximum heating', 'Chauffage maximal'),
  economic: t('Economy', 'Économie'),
  dehumidification: t('Dehumidification', 'Déshumidification'),
  calibration: t('Calibration', 'Étalonnage'),
  'emergency-cool': t('Emergency cooling', 'Refroidissement de secours'),
  'emergency-steam': t('Emergency steam', 'Vapeur de secours'),
  'no-demand': t('No demand', 'Aucune demande'),
  nominal: t('Nominal ventilation', 'Ventilation nominale'),
  'humidity-protection': t('Humidity protection', 'Protection humidité'),
  none: t('None', 'Aucun'),
});

/** The text of a mode value: its name, the appliance model, or "code N". */
export function modeText(value, language) {
  if (value?.key !== undefined) {
    const name = MODE_NAMES[value.key];
    return name ? word(name, language) : value.key;
  }
  return word(t(`Unknown code ${value?.code}`, `Code inconnu ${value?.code}`), language);
}

export const faultCodeText = (code, language) =>
  code === 0
    ? word(t('None', 'Aucun'), language)
    : word(t(`Code ${code}`, `Code ${code}`), language);

export const STATUS = Object.freeze({
  noAddress: t(
    'Type the IP address of the ISM8i, then save: nothing listens before.',
    'Saisissez l’adresse IP de l’ISM8i, puis enregistrez : rien n’écoute avant.',
  ),
  badAddress: t(
    'The address of the ISM8i is not a valid IP address (no name, no port): nothing listens.',
    'L’adresse de l’ISM8i n’est pas une adresse IP valide (ni nom, ni port) : rien n’écoute.',
  ),
  configUnread: (attempt) =>
    t(
      `The configuration could not be read from Gladys (attempt ${attempt}); trying again.`,
      `La configuration n’a pas pu être lue dans Gladys (essai ${attempt}) ; nouvel essai.`,
    ),
  linkDown: (detail) =>
    t(
      `The receiver of the ISM8 connection is not running (${detail}); started again every minute.`,
      `Le récepteur de la connexion de l’ISM8 ne tourne pas (${detail}) ; relancé chaque minute.`,
    ),
  linkUnreachable: t(
    'The receiver of the ISM8 connection runs but does not answer this container yet.',
    'Le récepteur de la connexion de l’ISM8 tourne mais ne répond pas encore à ce conteneur.',
  ),
  waiting: (port, host) =>
    t(
      `Waiting for the ISM8i (${host}): in its web page, set the server to the IP address of the Gladys machine and the port ${port ?? '(shown once the receiver started)'}.`,
      `En attente de l’ISM8i (${host}) : dans sa page web, indiquez comme serveur l’adresse IP de la machine Gladys et le port ${port ?? '(affiché une fois le récepteur lancé)'}.`,
    ),
  connected: (host, count) =>
    t(
      `ISM8i connected from ${host}, ${count} values received.`,
      `ISM8i connecté depuis ${host}, ${count} valeurs reçues.`,
    ),
  refused: (from, count) =>
    t(
      ` ${count} connection(s) refused from ${from}: not the address of the ISM8i (if Docker hides the real address on this machine, see the documentation).`,
      ` ${count} connexion(s) refusée(s) depuis ${from} : ce n’est pas l’adresse de l’ISM8i (si Docker masque la vraie adresse sur cette machine, voir la documentation).`,
    ),
  writesOff: t(' Writes are off.', ' Écritures désactivées.'),
  stopsPending: (count) =>
    t(
      ` ${count} stop(s) waiting for the ISM8i (sent as soon as it connects).`,
      ` ${count} arrêt(s) en attente de l’ISM8i (envoyé(s) dès sa connexion).`,
    ),
  stopsUnconfirmed: (count) =>
    t(
      ` ${count} stop(s) sent 3 times without confirmation: check the boiler.`,
      ` ${count} arrêt(s) envoyé(s) 3 fois sans confirmation : vérifiez la chaudière.`,
    ),
  dataUnreadable: t(
    ' /data/ism8.json cannot be read: the stops are not kept across restarts.',
    ' /data/ism8.json est illisible : les arrêts ne sont pas gardés d’un redémarrage à l’autre.',
  ),
  lastCommand: (text) => t(` Last command: ${text.en}`, ` Dernière commande : ${text.fr}`),
});

/** Command outcomes (in the status and the logs; the ack never reaches the user). */
export const COMMAND = Object.freeze({
  success: t('applied (read back).', 'appliquée (relue).'),
  already: t('already in place.', 'déjà en place.'),
  unconfirmed: t('sent, without confirmation yet.', 'envoyée, sans confirmation pour l’instant.'),
  kept: t(
    'stop kept: sent as soon as the ISM8i connects.',
    'arrêt gardé : envoyé dès que l’ISM8i se connecte.',
  ),
  notSent: (why) => t(`not sent (${why.en}).`, `rien envoyé (${why.fr}).`),
  why: {
    writesOff: t(
      'writes are off in the configuration',
      'écritures désactivées dans la configuration',
    ),
    noSession: t('the ISM8i is not connected', 'l’ISM8i n’est pas connecté'),
    unknownValue: t(
      'the current value was not read since the ISM8i connected',
      'la valeur actuelle n’a pas été lue depuis la connexion de l’ISM8i',
    ),
    invalid: t('invalid value', 'valeur invalide'),
    aboveCap: (cap) =>
      t(
        `above the hot water ceiling of ${cap} °C`,
        `au-dessus du plafond d’eau chaude de ${cap} °C`,
      ),
    busy: t(
      'a command on this setting is still running',
      'une commande sur ce réglage est en cours',
    ),
    stopRunning: t(
      'a stop of this circuit is not confirmed yet',
      'un arrêt de ce circuit n’est pas encore confirmé',
    ),
    late: t('not sent in time', 'pas envoyée à temps'),
    link: t('the receiver did not take it', 'le récepteur ne l’a pas prise'),
    notWritable: t('this value is read only', 'cette valeur est en lecture seule'),
    dataSave: t('/data could not be written', '/data n’a pas pu être écrit'),
  },
});

export const REFRESH = Object.freeze({
  sent: t(
    'Asked the ISM8i for every value: they arrive within a few seconds.',
    'Toutes les valeurs ont été demandées à l’ISM8i : elles arrivent en quelques secondes.',
  ),
  tooSoon: (seconds) =>
    t(
      `Asked less than 30 s ago: try again in ${seconds} s.`,
      `Demandé il y a moins de 30 s : réessayez dans ${seconds} s.`,
    ),
  stopInFlight: t(
    'A stop is waiting for its confirmation: try again in 20 s.',
    'Un arrêt attend sa confirmation : réessayez dans 20 s.',
  ),
  noSession: t(
    'The ISM8i is not connected: nothing asked.',
    'L’ISM8i n’est pas connecté : rien demandé.',
  ),
});
