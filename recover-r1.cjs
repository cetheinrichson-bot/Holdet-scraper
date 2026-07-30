/**
 * recover-r1.cjs
 * Gendanner runde 1 - data er indbygget i scriptet, ingen ekstra filer noedvendige.
 */

const admin = require("firebase-admin");
const fs = require("fs");

const ROUND = "r1";

// Runde 1 vaerdier hentet fra scraperens commit mandag 27. juli
const R1 = {"Abdou Aziz Ndiaye":-5000,"Abdoulaye Gouba":-5000,"Abdul Daramy":-5000,"Abdul Moro":12000,"Adam Gabriel":42000,"Adam Herdonsson":-6000,"Adam Kleis-Kristoffersen":32000,"Adam Sørensen":-9000,"Adrian Justinussen":159000,"Alagie Saine":14000,"Alamara Djabi":-5000,"Albert Rrahmani":-5000,"Alexander Busch":-5000,"Alexander Lind":-5000,"Alexander Lyng":-14000,"Alexander Priesborg Madsen":12000,"Alexander Simmelhack":12000,"Ali Al-Najar":-5000,"Amin Al-Hamawi":-5000,"Anders Bergholt Pedersen":-14000,"Anders Hoeg":-5000,"Anders Hoff":-5000,"André Escobar Jensen":-5000,"Andreas Bruus":-5000,"Andreas Cornelius":56000,"Andreas Gülstorff":-5000,"Andreas Hansen":29000,"Andreas Oggesen":-5000,"Andreas Poulsen":-5000,"Anssi Suhonen":-5000,"Anton Mayland":0,"Aral Simsir":0,"Araphat Mohammed":-5000,"Asbjørn Bøndergaard":23000,"Aske Andresen":19000,"Asker Beck":52000,"Bartosz Slisz":144000,"Bastian Holm":-5000,"Ben Godfrey":0,"Benjamin Örn":12000,"Benjamin Tahirovic":-5000,"Bilal Brahimi":42000,"Bilal Konteh":-5000,"Birger Meling":376000,"Bror Blume":0,"Caleb Yirenkyi":14000,"Callum McCowatt":84000,"Casper 'Dani' Winther":-5000,"Charly Nouck Horneman":42000,"Christ Tape":0,"Christian Storch":-5000,"Christian Vestergaard":-5000,"Cyril Edudzi":14000,"Dalton Wilkins":-5000,"Daniel Anyembe":32000,"Daniel Høegh":14000,"Daniel Ingi Johannesson":-5000,"Daniel Leo Gretarsson":-10000,"Daniel Wass":4000,"Dario Osorio":116000,"Denil Castillo":42000,"Dennis Smarsch":-5000,"Diallo Sanoussi":0,"Django Warmerdam":0,"Dominik Kotarski":61000,"Dorian Junior":52000,"Ebube Duru":-10000,"Edward Chilufya":-5000,"Elias Achouri":0,"Elias Hjort-Pedersen":-5000,"Elias Rafn Olafsson":61000,"Elies Mahmoud":14000,"Emil Monrad":-5000,"Emmanuel Dennis":-5000,"Eric Kahl":-6000,"Ernest Agyiri":-5000,"Fallou Sene":-5000,"Felix Beijmo":46000,"Felix Sommer":-5000,"Fiete Arp":11000,"Filip Bundgaard Kristensen":2000,"Filip Djukic":0,"Franculino Dju":46000,"Frederik Alves Ibsen":-5000,"Frederik Brandhof":12000,"Frederik Damkjer":-5000,"Frederik Emmery":14000,"Frederik Gytkjær":-1000,"Frederik Lauenborg":-5000,"Frederik Tingager":14000,"Gabriel Pereira":36000,"Gavin Beavers":-5000,"Geovanni Vianney Ndjee":26000,"Gift Links":24000,"Graham Ankamafio":0,"Gue-sung Cho":66000,"Gunnar Orri Olsen":-5000,"Gustav Fraulo":-5000,"Han-beom Lee":-5000,"Hjalte Bidstrup":-5000,"Hjalte Boe Rasmussen":12000,"Ibrahim Adel":12000,"Isak Snær Thorvaldsson":-25000,"Ismahila Ouedraogo":-9000,"Ivan Milicevic":12000,"Jacob Ambæk":4000,"Jacob Andersen":4000,"Jakob Bonde":-9000,"Jakob Busk":-5000,"James Bogere":22000,"James Gomez":-29000,"Janni Serra":-5000,"Jannich Storch":39000,"Jay-Roy Grot":-5000,"Jens Jakob Thomasen":-1000,"Jens Martin Gammelby":14000,"Jeppe Grønning":22000,"Jesper Hansen":19000,"John Batigi":-5000,"John Björkengren":14000,"Jona Niemiec":1000,"Jonas 'AJ' Jensen-Abbew":22000,"Jonathan Ægidius":-5000,"Jonathan Moalem":-5000,"Jordi Vanlerberghe":14000,"Juho Lähteenmäki":14000,"Julius Berthel Askou":-5000,"Julius Emefile":242000,"Julius Lorents Nielsen":14000,"Julius Madsen":34000,"Junior Brumado":-5000,"Junnosuke Suzuki":32000,"Justin Janssen":14000,"Karlo Lusavec":14000,"Kasper Kiilerich":142000,"Kenay Myrie":-5000,"Kevin Yakob":-5000,"Kristian Arnstad":184000,"Kristian Kirkegaard":14000,"Lamine Sadio":44000,"Lasse Legolas":-1000,"Lasse Mandal":-5000,"Lauge Sandgrav":-5000,"Laurits Raun Pedersen":-6000,"Levy Nene":-5000,"Liam West":-5000,"Lirim Qamili":-5000,"Lucas Lissens":24000,"Lucas Lund Pedersen":-5000,"Luis Binks":54000,"Lukas Emil Kirkegaard":92000,"Mads Bech Sørensen":231000,"Mads Emil Madsen":102000,"Mads Freundlich":-5000,"Mads Frøkjær-Jensen":22000,"Mads Hedenstad":-5000,"Mads Larsen":14000,"Mads Søndergaard":-5000,"Mads Søndergaard Nielsen":-5000,"Magnus Andersen":-1000,"Magnus Knudsen":14000,"Magnus Mattsson":-5000,"Magnus Riisgaard Jensen":175000,"Magnus Warming":0,"Malik Abubakari":-1000,"Malik Pimpong":0,"Malte Heyde":12000,"Mansour Samb":0,"Marcos Lopez":26000,"Marcus Bundgaard Sørensen":0,"Marcus Eskildsen":-5000,"Marcus McCoy":-9000,"Mark Brink":-5000,"Marko Divkovic":-6000,"Markus Solbakken":-5000,"Markus Walker":-5000,"Martin Andre Sjølstad":74000,"Martin Erlic":56000,"Martin Hansen":1000,"Matej Delac":39000,"Mathias Greve":12000,"Mathias Hebo Rasmussen":-5000,"Mathias Jensen":4000,"Mathias Kaarsbo Winther":-5000,"Mats Köhlert":-8000,"Matthew Hoppe":-22000,"Max Albæk Andersen":-5000,"Max Ejdum":22000,"Maxime Soulas":-10000,"Mayckel Lahdo":0,"Mees Hoedemakers":32000,"Melker Jonsson":-5000,"Mert Demirci":-5000,"Mihajlo Ivancevic":0,"Mikael Uhre":-5000,"Mike Themsen":164000,"Mikel Gogorza":-5000,"Mikkel Bach Løndal":0,"Mikkel Fischer":5000,"Mikkel Kupijbida":14000,"Mikkel Øxenberg":-5000,"Mohamed Cherif Haidara":140000,"Mohamed Elyounoussi":246000,"Musa Toure":-5000,"Neil Pierre":0,"Nicklas Mouritsen":0,"Nicklas Røjkjær":164000,"Nicolai Dybdal":-5000,"Nicolai Flø":-5000,"Nicolai Poulsen":-5000,"Nicolai Vallys":0,"Nicolas Bürgy":0,"Nikolas Dyhr":12000,"Noah Ganaus":-9000,"Noah Markmann":-5000,"Noah Nguyen":-5000,"Ola Solbakken":-5000,"Ole Martin Kolskogen":14000,"Oliver Bundgaard Kristensen":152000,"Oliver Højer":-5000,"Oliver Jones":-5000,"Oliver Ross":169000,"Oliver Villadsen":14000,"Olti Hyseni":120000,"Oscar Buur":-5000,"Oskar Buur":3000,"Oskar Fenger":4000,"Oskar Haugstrup":-5000,"Oskar Snorre":-5000,"Osman Addo":-5000,"Ousmane Diao":-5000,"Ousmane Sow":-5000,"Ousseynou Fall Seck":12000,"Ovie Ejeheri":-5000,"Pachanga Kristensen":-5000,"Pantelis Hatzidiakos":0,"Patrick Mortensen":22000,"Patrick Olsen":0,"Patrick Pentz":-5000,"Paul Izzo":-5000,"Pedro Bravo":66000,"Pedro Ganchas":-5000,"Peter Ankersen":14000,"Philip Billing":116000,"Pontus Rödin":-5000,"Prince Amoako Junior":14000,"Rami Al-Hajj":14000,"Raphael Canut":-5000,"Rasmus Carstensen":22000,"Rasmus Falk Jensen":-5000,"Rasmus Lauritsen":-5000,"Rasmus Vinderslev":-5000,"Renzo Tytens":170000,"Robert":62000,"Robin Østrøm":14000,"Rodrigo Huescas":-5000,"Runar Alex Runarsson":-5000,"Runar Norheim":14000,"Runar Thor Sigurgeirsson":-5000,"Sabil Osman Hansen":-5000,"Sami Jalal Karchoud":32000,"Sean Klaiber":-5000,"Sebastian Hausner":-5000,"Sebastian Jørgensen":4000,"Sebastian Larsen":-5000,"Sefer Emini":-10000,"Seniko Doua":-5000,"Sho Fukuda":-5000,"Simon Colyn":155000,"Simon Stüker":-5000,"Simon Wæver":-2000,"Sofus Berger":12000,"Souleymane Alio":-5000,"Srdan Kuzmic":92000,"Stefen Tchamche":-5000,"Stephen Acquah":12000,"Stipe Radic":0,"Theo Sander":0,"Thomas Delaney":36000,"Thomas Jørgensen":232000,"Thomas Mikkelsen":0,"Tim Freriks":-5000,"Tobias Bech Kristensen":14000,"Tobias Klysner":-5000,"Tobias Mølgaard":-5000,"Tobias Salquist":-6000,"Tobias Sommer":0,"Tobias Storm":0,"Tomas Oli Kristjansson":12000,"Valdemar Byskov Andreasen":256000,"Victor Bak Jensen":46000,"Victor Gustafsen":-5000,"Victor Palsson":14000,"Viggo Bønstrup Poulsen":-5000,"Viktor Bjarki Dadason":-5000,"Viljar Myhra":-5000,"Villads Rutkjær":-5000,"Villads Westh":34000,"Villum Berthelsen":34000,"Vitus Friis":-5000,"Warren Caddy":-5000,"Wessel Dammers":14000,"William Clem":42000,"William Kirk":14000,"William Martin":-5000,"William Sonne-Schmidt":24000,"William Steindorsson":-9000,"Yamirou Ouorou":24000,"Yaya Bojang":0,"Yonis Njoh":-5000,"Younes Bakiz":22000,"Youssoufa Moukoko":46000,"Zan Zaletel":72000,"Zander Grantzau":-5000,"Hector Lux":-5000,"Daniel Freyr Kristjansson":-5000,"Adam Amrani":-5000,"David Boison Frimpong":-14000,"Rasmus Nissen Kristensen":36000,"Luka Callø":-5000,"Youssouph Badji":-5000,"Richmond Gyamfi":-5000,"Beni Junior":52000,"Christian Peter Bøje Jørgensen":-5000,"Jonatan Lindekilde":-5000,"Dani Silva":-5000,"Philip Berendt Søndergaard":-5000,"Lukas Larsen":-5000,"Emmanuel Yeboah":0,"Marcus Younis":24000,"Stanley Iheanacho":-5000,"Sedat Bayrak":0,"Gustav Wagner":-5000,"Omran Khatar":-5000,"Munashe Garananga":42000,"Hunor Nemeth":-5000,"Dominik Sarapata":-5000,"Peter Therkildsen":-9000,"Oskar Boesen":0,"Muhamet Hyseni":-5000,"Kwaku Karikari":-5000,"Nordin Bakker":-5000,"Sofus Johannesen":-5000,"Mikael Anderson":4000,"Mohamed Iyadh Riahi":-5000,"Mohamed Sankoh":14000,"Jimi Tauriainen":12000,"Diego Kochen":10000,"Adrian Kappenberger":-5000,"Jens Jønsson":22000,"Friday Etim":32000,"Mustapha Nyassi":-5000,"Alex Kral":36000,"William Faber":-5000,"Cornelius Allen":-29000,"Lucas Riisgaard":12000,"Julius Korkko":-5000,"Kjell-Arik Wätjen":-5000,"Mathias Olesen":-2000,"Topi Keskinen":1000,"Jordan Larsson":-5000,"Kasper Junker":12000,"Ulrik Yttergård Jenssen":-1000,"Ismail Seydi":-6000,"Marvin Nasnas":-5000,"Berkant Bayrak":-5000,"Philip Keller":32000,"Nikolaj Juul-Sandberg":-1000,"Noah Hovgaard Lassen":-5000,"Mohamed Daff":-5000,"Mouhammade Camara":-5000,"Davíd Helgi Aronsson":-5000,"Oscar Mandrup":12000,"Andreas Søndenbroe":-5000,"William Møller":14000,"Malthe Hansen":-5000};

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      fs.readFileSync("./serviceAccountKey.json", "utf8"))
  ),
  databaseURL: "https://superliga-fantasy-14c4e-default-rtdb.europe-west1.firebasedatabase.app",
});
const db = admin.database();

async function run() {
  const navne = Object.keys(R1);
  const nonZero = navne.filter(n => R1[n] !== 0).length;
  console.log("Indbygget data: " + navne.length + " spillere, " + nonZero + " med vaerdi != 0\n");

  const [pSnap, mSnap] = await Promise.all([
    db.ref("players").once("value"),
    db.ref("managers").once("value"),
  ]);
  const players  = pSnap.val() || {};
  const managers = mSnap.val() || {};

  const nameToKey = {};
  for (const [k, p] of Object.entries(players)) if (p.fullName) nameToKey[p.fullName] = k;

  const updates = {};
  let restored = 0, missing = 0;
  for (const navn of navne) {
    const key = nameToKey[navn];
    if (!key) { missing++; continue; }
    const g = R1[navn];
    updates["players/" + key + "/roundGrowth/" + ROUND] = g;
    if (!players[key].roundGrowth) players[key].roundGrowth = {};
    players[key].roundGrowth[ROUND] = g;
    restored++;
  }
  console.log("Gendanner r1 for " + restored + " spillere (" + missing + " ikke i Firebase)");

  // Genberegn totalGrowth for alle
  for (const [key, p] of Object.entries(players)) {
    const rg = p.roundGrowth || {};
    updates["players/" + key + "/totalGrowth"] =
      Object.values(rg).reduce((a, b) => a + (Number(b) || 0), 0);
  }

  console.log("\nRundescore for r1:");
  const res = [];
  for (const [mgr, md] of Object.entries(managers)) {
    if (md.isAdmin) continue;
    const starters = (md.lineup && md.lineup[ROUND] && md.lineup[ROUND].starters) || [];
    if (!starters.length) { console.log("  " + mgr + ": ingen gemt opstilling - springes over"); continue; }
    let score = 0;
    for (const n of starters) {
      const k = nameToKey[n];
      score += (k && players[k] && players[k].roundGrowth && players[k].roundGrowth[ROUND]) || 0;
    }
    updates["managers/" + mgr + "/roundScores/" + ROUND] = score;
    res.push([mgr, score]);
  }
  res.sort((a, b) => b[1] - a[1]);
  res.forEach(([m, s], i) =>
    console.log("  " + (i + 1) + ". " + m + ": " + (s >= 0 ? "+" : "") + Math.round(s / 1000) + "k"));

  await db.ref().update(updates);
  console.log("\nOK - runde 1 gendannet!");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
