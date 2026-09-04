/**
 * force-r6.cjs
 * Skriver runde 6-vaerdierne (scrape 3/9 kl. 22:48) direkte til Firebase.
 * Data er indbygget - laeser IKKE data/latest.json, som er overskrevet.
 *
 * Env: DRY_RUN="false" for at gennemfoere.
 */

const admin = require("firebase-admin");
const fs = require("fs");

const ROUND = "r6";
const DRY_RUN = process.env.DRY_RUN !== "false";

// Vaerdier fra scrape 2026-09-03 22:48 dansk tid - inkl. de udskudte kampe
const R6 = {"Abdou Aziz Ndiaye":37000,"Abdoulaye Gouba":-5000,"Abdul Daramy":0,"Abdul Moro":-6000,"Adam Gabriel":0,"Adam Herdonsson":-20000,"Adam Kleis-Kristoffersen":34000,"Adam Sørensen":22000,"Adrian Justinussen":0,"Alagie Saine":-10000,"Alamara Djabi":-10000,"Albert Rrahmani":0,"Alexander Busch":-5000,"Alexander Lind":160000,"Alexander Lyng":0,"Alexander Priesborg Madsen":24000,"Alexander Simmelhack":-5000,"Ali Al-Najar":-5000,"Amin Al-Hamawi":-5000,"Anders Bergholt Pedersen":-5000,"Anders Hoeg":-1000,"Anders Hoff":-5000,"André Escobar Jensen":-5000,"Andreas Bruus":-5000,"Andreas Cornelius":106000,"Andreas Gülstorff":-10000,"Andreas Hansen":82000,"Andreas Oggesen":-1000,"Andreas Poulsen":-5000,"Anssi Suhonen":-5000,"Anton Mayland":0,"Aral Simsir":0,"Araphat Mohammed":-10000,"Asbjørn Bøndergaard":4000,"Aske Andresen":34000,"Asker Beck":246000,"Bartosz Slisz":25000,"Bastian Holm":-5000,"Ben Godfrey":0,"Benjamin Örn":-5000,"Benjamin Tahirovic":0,"Bilal Brahimi":-5000,"Bilal Konteh":-10000,"Birger Meling":27000,"Bror Blume":0,"Caleb Yirenkyi":0,"Callum McCowatt":-10000,"Casper 'Dani' Winther":14000,"Charly Nouck Horneman":241000,"Christ Tape":0,"Christian Storch":-10000,"Christian Vestergaard":-5000,"Cyril Edudzi":-5000,"Dalton Wilkins":-1000,"Daniel Anyembe":42000,"Daniel Høegh":44000,"Daniel Ingi Johannesson":0,"Daniel Leo Gretarsson":-15000,"Daniel Wass":1000,"Dario Osorio":14000,"Denil Castillo":216000,"Dennis Smarsch":-5000,"Diallo Sanoussi":0,"Django Warmerdam":0,"Dominik Kotarski":-5000,"Dorian Junior":189000,"Ebube Duru":-15000,"Edward Chilufya":37000,"Elias Achouri":0,"Elias Hjort-Pedersen":-5000,"Elias Rafn Olafsson":181000,"Elies Mahmoud":204000,"Emil Monrad":-5000,"Emmanuel Dennis":-5000,"Eric Kahl":-29000,"Ernest Agyiri":0,"Fallou Sene":-5000,"Felix Beijmo":156000,"Felix Sommer":-5000,"Fiete Arp":4000,"Filip Bundgaard Kristensen":-7000,"Filip Djukic":0,"Franculino Dju":-1000,"Frederik Alves Ibsen":-5000,"Frederik Brandhof":-5000,"Frederik Damkjer":42000,"Frederik Emmery":-9000,"Frederik Gytkjær":-16000,"Frederik Lauenborg":-5000,"Frederik Tingager":-10000,"Gabriel Pereira":39000,"Gavin Beavers":-5000,"Geovanni Vianney Ndjee":-10000,"Gift Links":-10000,"Graham Ankamafio":0,"Gue-sung Cho":74000,"Gunnar Orri Olsen":-10000,"Gustav Fraulo":22000,"Han-beom Lee":0,"Hjalte Bidstrup":34000,"Hjalte Boe Rasmussen":203000,"Ibrahim Adel":35000,"Isak Snær Thorvaldsson":147000,"Ismahila Ouedraogo":14000,"Ivan Milicevic":165000,"Jacob Ambæk":-5000,"Jacob Andersen":-13000,"Jakob Bonde":192000,"Jakob Busk":-10000,"James Bogere":7000,"James Gomez":-6000,"Janni Serra":128000,"Jannich Storch":-5000,"Jay-Roy Grot":-5000,"Jens Jakob Thomasen":-5000,"Jens Martin Gammelby":24000,"Jeppe Grønning":56000,"Jesper Hansen":-10000,"John Batigi":-5000,"John Björkengren":44000,"Jona Niemiec":-5000,"Jonas 'AJ' Jensen-Abbew":0,"Jonathan Ægidius":-5000,"Jonathan Moalem":0,"Jordi Vanlerberghe":-15000,"Juho Lähteenmäki":77000,"Julius Berthel Askou":-8000,"Julius Emefile":-33000,"Julius Lorents Nielsen":12000,"Julius Madsen":-30000,"Junior Brumado":-10000,"Junnosuke Suzuki":86000,"Justin Janssen":207000,"Karlo Lusavec":-10000,"Kasper Kiilerich":71000,"Kenay Myrie":-10000,"Kevin Yakob":-10000,"Kristian Arnstad":-49000,"Kristian Kirkegaard":-6000,"Lamine Sadio":-6000,"Lasse Legolas":-5000,"Lasse Mandal":-5000,"Lauge Sandgrav":-6000,"Laurits Raun Pedersen":44000,"Levy Nene":0,"Liam West":-5000,"Lirim Qamili":-5000,"Lucas Lissens":-5000,"Lucas Lund Pedersen":-5000,"Luis Binks":-15000,"Lukas Emil Kirkegaard":56000,"Mads Bech Sørensen":-1000,"Mads Emil Madsen":296000,"Mads Freundlich":-5000,"Mads Frøkjær-Jensen":-15000,"Mads Hedenstad":11000,"Mads Larsen":14000,"Mads Søndergaard":116000,"Mads Søndergaard Nielsen":-5000,"Magnus Andersen":22000,"Magnus Knudsen":-49000,"Magnus Mattsson":-10000,"Magnus Riisgaard Jensen":136000,"Magnus Warming":0,"Malik Abubakari":-5000,"Malik Pimpong":0,"Malte Heyde":23000,"Mansour Samb":0,"Marcos Lopez":156000,"Marcus Bundgaard Sørensen":-5000,"Marcus Eskildsen":-5000,"Marcus McCoy":4000,"Mark Brink":121000,"Marko Divkovic":1000,"Markus Solbakken":-22000,"Markus Walker":-10000,"Martin Andre Sjølstad":44000,"Martin Erlic":107000,"Martin Hansen":-5000,"Matej Delac":5000,"Mathias Greve":44000,"Mathias Hebo Rasmussen":4000,"Mathias Jensen":-5000,"Mathias Kaarsbo Winther":-5000,"Mats Köhlert":-17000,"Matthew Hoppe":-1000,"Max Albæk Andersen":-5000,"Max Ejdum":-17000,"Maxime Soulas":-15000,"Mayckel Lahdo":0,"Mees Hoedemakers":0,"Melker Jonsson":-5000,"Mert Demirci":-5000,"Mihajlo Ivancevic":0,"Mikael Uhre":-10000,"Mike Themsen":294000,"Mikel Gogorza":-10000,"Mikkel Bach Løndal":0,"Mikkel Fischer":14000,"Mikkel Kupijbida":-5000,"Mikkel Øxenberg":-5000,"Mohamed Cherif Haidara":-5000,"Mohamed Elyounoussi":526000,"Musa Toure":-5000,"Neil Pierre":0,"Nicklas Mouritsen":0,"Nicklas Røjkjær":-3000,"Nicolai Dybdal":-5000,"Nicolai Flø":10000,"Nicolai Poulsen":-10000,"Nicolai Vallys":0,"Nicolas Bürgy":0,"Nikolas Dyhr":44000,"Noah Ganaus":52000,"Noah Markmann":37000,"Noah Nguyen":-5000,"Ola Solbakken":-10000,"Ole Martin Kolskogen":-10000,"Oliver Bundgaard Kristensen":44000,"Oliver Højer":22000,"Oliver Jones":32000,"Oliver Ross":4000,"Oliver Villadsen":-15000,"Olti Hyseni":-7000,"Oscar Buur":0,"Oskar Buur":74000,"Oskar Fenger":1000,"Oskar Haugstrup":-10000,"Oskar Snorre":-5000,"Osman Addo":-5000,"Ousmane Diao":-10000,"Ousmane Sow":0,"Ousseynou Fall Seck":-5000,"Ovie Ejeheri":-10000,"Pachanga Kristensen":-5000,"Pantelis Hatzidiakos":0,"Patrick Mortensen":126000,"Patrick Olsen":0,"Patrick Pentz":10000,"Paul Izzo":69000,"Pedro Bravo":66000,"Pedro Ganchas":-5000,"Peter Ankersen":27000,"Philip Billing":126000,"Pontus Rödin":-5000,"Prince Amoako Junior":61000,"Rami Al-Hajj":14000,"Raphael Canut":-5000,"Rasmus Carstensen":-23000,"Rasmus Falk Jensen":14000,"Rasmus Lauritsen":0,"Rasmus Vinderslev":-15000,"Renzo Tytens":-6000,"Robert":316000,"Robin Østrøm":14000,"Rodrigo Huescas":-10000,"Runar Alex Runarsson":-10000,"Runar Norheim":107000,"Runar Thor Sigurgeirsson":-5000,"Sabil Osman Hansen":24000,"Sami Jalal Karchoud":76000,"Sean Klaiber":-5000,"Sebastian Hausner":-5000,"Sebastian Jørgensen":67000,"Sebastian Larsen":-5000,"Sefer Emini":-15000,"Seniko Doua":-5000,"Sho Fukuda":1000,"Simon Colyn":22000,"Simon Stüker":-10000,"Simon Wæver":0,"Sofus Berger":12000,"Souleymane Alio":-10000,"Srdan Kuzmic":66000,"Stefen Tchamche":-43000,"Stephen Acquah":17000,"Stipe Radic":0,"Theo Sander":0,"Thomas Delaney":54000,"Thomas Jørgensen":0,"Thomas Mikkelsen":0,"Tim Freriks":-5000,"Tobias Bech Kristensen":-13000,"Tobias Klysner":-5000,"Tobias Mølgaard":-10000,"Tobias Salquist":47000,"Tobias Sommer":0,"Tobias Storm":0,"Tomas Oli Kristjansson":-10000,"Valdemar Byskov Andreasen":-5000,"Victor Bak Jensen":37000,"Victor Gustafsen":-10000,"Victor Palsson":-10000,"Viggo Bønstrup Poulsen":-5000,"Viktor Bjarki Dadason":84000,"Viljar Myhra":19000,"Villads Rutkjær":-10000,"Villads Westh":14000,"Villum Berthelsen":17000,"Vitus Friis":-5000,"Warren Caddy":-5000,"Wessel Dammers":-5000,"William Clem":76000,"William Kirk":164000,"William Martin":-5000,"William Sonne-Schmidt":-5000,"William Steindorsson":-5000,"Yamirou Ouorou":-6000,"Yaya Bojang":0,"Yonis Njoh":-5000,"Younes Bakiz":-5000,"Youssoufa Moukoko":-5000,"Zan Zaletel":56000,"Zander Grantzau":-10000,"Hector Lux":32000,"Daniel Freyr Kristjansson":-5000,"Adam Amrani":-5000,"David Boison Frimpong":-5000,"Rasmus Nissen Kristensen":116000,"Luka Callø":-13000,"Youssouph Badji":-10000,"Richmond Gyamfi":-5000,"Beni Junior":134000,"Christian Peter Bøje Jørgensen":-10000,"Jonatan Lindekilde":0,"Dani Silva":-5000,"Philip Berendt Søndergaard":0,"Lukas Larsen":-5000,"Emmanuel Yeboah":0,"Marcus Younis":-7000,"Stanley Iheanacho":226000,"Sedat Bayrak":0,"Gustav Wagner":-5000,"Omran Khatar":-5000,"Munashe Garananga":-6000,"Hunor Nemeth":-10000,"Dominik Sarapata":-5000,"Peter Therkildsen":4000,"Oskar Boesen":0,"Muhamet Hyseni":0,"Kwaku Karikari":0,"Nordin Bakker":-10000,"Sofus Johannesen":76000,"Mikael Anderson":-17000,"Mohamed Iyadh Riahi":-5000,"Mohamed Sankoh":4000,"Jimi Tauriainen":100000,"Diego Kochen":49000,"Adrian Kappenberger":-5000,"Jens Jønsson":-10000,"Friday Etim":389000,"Mustapha Nyassi":-10000,"Alex Kral":266000,"William Faber":-10000,"Cornelius Allen":4000,"Lucas Riisgaard":24000,"Julius Korkko":-6000,"Kjell-Arik Wätjen":74000,"Mathias Olesen":-5000,"Topi Keskinen":14000,"Jordan Larsson":0,"Kasper Junker":112000,"Ulrik Yttergård Jenssen":4000,"Ismail Seydi":25000,"Marvin Nasnas":74000,"Berkant Bayrak":-5000,"Philip Keller":42000,"Nikolaj Juul-Sandberg":-5000,"Noah Hovgaard Lassen":-5000,"Mohamed Daff":-10000,"Mouhammade Camara":-23000,"Davíd Helgi Aronsson":-5000,"Oscar Mandrup":-5000,"Andreas Søndenbroe":-10000,"William Møller":22000,"Malthe Hansen":22000,"Kelvin Ehibhatiomhan":115000,"Teodor Haltvik":-5000,"Hamuza Sengooba":-10000,"Colin Rösler":-49000,"Akos Markgraf":97000,"Bubacarr Tambedou":-1000,"Jacob Steen Christensen":-15000,"Christopher Olivier":-5000,"Brynjar Ingi Bjarnason":-65000,"Valgeir Lunddal":-5000,"Alexander Munksgaard":160000,"Carljohan 'Saku' Eriksson":-10000,"Diant Ramaj":191000,"Alexander Ahl Holmström":84000,"Christian Gammelgaard":4000,"Thapelo Maseko":27000,"Mael De Gevigney":4000,"Asger Sørensen":144000,"Giulio":-5000,"Anton Mandrup":-5000,"Kristian Bøgild":22000,"Axel Henriksson":-18000,"Matej Tuka":-10000,"Mikkel Rakneberg":0,"Amady Camara":0,"Nikolai Hopland":0,"Maher Carrizo":-5000,"Ruben Alte":0,"David Martinez":-5000,"Jon Sölvi Simonarson":0,"Zidan Sertdemir":0,"Osaze De Rosario":0,"Julian Pauli":0,"Valassina Diomande":0,"Hyun-seok Hong":-5000,"Fredrik Ulvestad":0,"Markus Anderson":0,"Mileta Rajovic":0,"Roald Mitchell":0,"Sanders Ngabo":0,"Stefan Velkov":0,"Victor Nelsson":-5000,"Lasso Coulibaly":0};

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      fs.readFileSync("./serviceAccountKey.json", "utf8"))
  ),
  databaseURL: "https://superliga-fantasy-14c4e-default-rtdb.europe-west1.firebasedatabase.app",
});
const db = admin.database();

async function run() {
  const navne = Object.keys(R6);
  const nz = navne.filter(n => R6[n] !== 0).length;
  console.log(DRY_RUN ? ">>> TESTKOERSEL - intet aendres <<<\n" : ">>> SKRIVER TIL r6 <<<\n");
  console.log("Indbygget: " + navne.length + " spillere, " + nz + " med vaerdi != 0\n");

  const [pSnap, mSnap] = await Promise.all([
    db.ref("players").once("value"),
    db.ref("managers").once("value"),
  ]);
  const players = pSnap.val() || {};
  const managers = mSnap.val() || {};

  const updates = {};
  let skrevet = 0, uaendret = 0, beskyttet = 0, ukendt = 0;
  const aendringer = [];

  for (const navn of navne) {
    const safe = navn.replace(/[.#$\/\[\]]/g, "_");
    const key = players[navn] ? navn : players[safe] ? safe : null;
    if (!key) { ukendt++; continue; }

    const eks = players[key].roundGrowth || {};
    const prev = eks[ROUND];
    const g = R6[navn];

    if (g === 0 && prev !== undefined && prev !== 0) { beskyttet++; continue; }
    if (prev === g) { uaendret++; continue; }

    updates["players/" + key + "/roundGrowth/" + ROUND] = g;
    let total = 0;
    for (const [rk, v] of Object.entries(eks)) total += rk === ROUND ? g : (Number(v) || 0);
    if (!(ROUND in eks)) total += g;
    updates["players/" + key + "/totalGrowth"] = total;
    skrevet++;
    aendringer.push([players[key].fullName || key, prev, g, players[key].owner]);
  }

  const f = v => v === undefined ? "(ingen)" : ((v >= 0 ? "+" : "") + Math.round(v / 1000) + "k");
  console.log("  opdateres : " + skrevet);
  console.log("  uaendret  : " + uaendret);
  console.log("  beskyttet : " + beskyttet);
  console.log("  ukendt    : " + ukendt);

  // Vis aendringer for spillere der ejes af en manager
  const ejede = aendringer.filter(a => a[3] && a[3] !== "Ledig");
  console.log("\nAendringer paa ejede spillere (" + ejede.length + "):");
  for (const [n, gl, ny, ow] of ejede.slice(0, 25)) {
    console.log("  " + n.padEnd(28) + ow.padEnd(11) + f(gl).padStart(9) + "  ->  " + f(ny));
  }

  // Vis hvad managernes r6-score bliver
  console.log("\nForventet r6-score pr. manager:");
  const nameToKey = {};
  for (const [k, p] of Object.entries(players)) if (p.fullName) nameToKey[p.fullName] = k;
  const nyVaerdi = n => {
    const k = nameToKey[n];
    if (!k) return 0;
    const u = updates["players/" + k + "/roundGrowth/" + ROUND];
    return u !== undefined ? u : (players[k].roundGrowth?.[ROUND] || 0);
  };
  for (const [m, md] of Object.entries(managers)) {
    if (md.isAdmin) continue;
    const st = md.lineup?.[ROUND]?.starters || [];
    if (!st.length) { console.log("  " + m.padEnd(12) + "ingen gemt opstilling"); continue; }
    const s = st.reduce((a, n) => a + nyVaerdi(n), 0);
    console.log("  " + m.padEnd(12) + f(s).padStart(9) + "   (" + st.length + " startere)");
  }

  if (!skrevet) { console.log("\nIngen aendringer."); process.exit(0); }

  if (DRY_RUN) {
    console.log("\nSaet DRY_RUN=false for at gennemfoere.");
  } else {
    await db.ref().update(updates);
    console.log("\nOK - r6 opdateret med de udskudte kampe.");
  }
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
