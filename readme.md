
You will find the English ReadMe at the end of the document.

# Übersicht

Dies stellt eine API zur Verfügung, um über Bluetooth (via WebBLE) mit dem Calliope mini 3 Log zu interagieren. Es beinhaltet auch eine Demo-Anwendung, die zeigt, wie es funktioniert.
Basierend auf der Erweiterung von https://github.com/bsiever

# Dateien / Manifest

* `ubitwebblelog.js`: Die eigentliche API (die einzige Datei, die für andere Anwendungen benötigt wird)
* Demo-Anwendung (eine webbasierte Konsole, die die verschiedenen Nachrichten anzeigt)
  * [`index.html`](https://github.com/calliope-edu/webblelog/blob/master/index.html): HTML mit eingebettetem JavaScript für die Anwendung  
    * [Live-Version anzeigen](https://calliope-edu.github.io/webblelog/) *Funktioniert nur in Chrome*  
    * [Lokale Live-Version anzeigen](./index.html) *Funktioniert nur in Chrome*
  * `style.css`
  * Benötigt `ubitwebblelog.js`
* Dokumentationsdateien:
  * [`readme.md`](https://github.com/calliope-edu/webblelog/blob/master/readme.md): Projektübersicht
  * [`docs`](https://calliope-edu.github.io/webblelog/docs/): Verzeichnis mit JSDoc-Dokumentation  
    * `jsdoc.md`: Startseite / Readme für die JSDocs
  * `_config.yml`: GitHub Pages Konfiguration
  * [`LICENSE`](./LICENSE): MIT-Lizenz

## Calliope mini Konfiguration

* Gehe zu https://makecode.calliope.cc  
* Erstelle ein neues Projekt  
* Füge die BLELog-Erweiterung hinzu  
  * + Erweiterungen  
  * Füge die URL `https://github.com/calliope-edu/pxt-blelog` in das Suchfeld ein und drücke Enter  
  * Klicke auf die Kachel, um die Erweiterung hinzuzufügen  
* Füge im `bei Start`-Block den Baustein `bluetooth datalogger service` aus `Data Logger Bluetooth` hinzu  
* Füge ebenfalls `set columns` von `data logger` in den `bei Start`-Block ein  
  * Gib hier die Namen der Spalten (Felder) an  
* Füge weitere Bausteine hinzu, um Datenpunkte zu erfassen und/oder das Log zu löschen.

```
ts
input.onButtonPressed(Button.A, function () {
    datalogger.log(
    datalogger.createCV("x", input.acceleration(Dimension.X)),
    datalogger.createCV("y", input.acceleration(Dimension.Y))
    )
})
input.onButtonPressed(Button.AB, function () {
    datalogger.deleteLog(datalogger.DeleteType.Fast)
})
blelog.startBLELogService()
datalogger.setColumnTitles(
"x",
"y"
)
```

# API

## Objekte

* `uBitManager`: Es sollte genau eine Instanz von `uBitManager` pro Anwendung erstellt werden. Diese dient zur Verbindung mit verfügbaren Calliope mini Datenloggern und zu deren Verwaltung. Alle Ereignisse von einzelnen micro:bits werden über den Manager weitergeleitet.

* `uBit`: Ein einzelnes Calliope mini Objekt. Es stellt Funktionen bereit, um z. B. das Label zu ändern, alle Daten zu aktualisieren, das Gerät zu entfernen usw.

Eine typische Anwendung wird:

1. Eine einzelne Instanz von `uBitManager` erstellen.
2. Sich für relevante Ereignisse registrieren.
3. Nutzer:innen erlauben, über `connect()` des `uBitManager` eine Verbindung zu den micro:bit Datenloggern herzustellen.
4. Interaktion ermöglichen über:
   * Reaktion auf eingehende Ereignisse (z. B. Graph- oder Log-Daten)
   * Aufruf von Funktionen für einzelne Calliope mini (`refresh()` Daten, `erase()`, usw.)

## Klassendiagramme

```
mermaid
classDiagram
    class uBitManager {
      +(async) void connect()
      +Map(any:uBit) getDevices() 
    }

    class uBit {
      +void disconnect()
      +string getLabel()
      +void setLabel()
      +[string] getCSV()
      +[string] getRawCSV()
      +[string] getHeaders()
      +[[string]] getData(start, end)
      +int getDataLength()
      +void sendErase()
      +void sendAuthorization(string)
      +void refreshData()
      +void remove()
    }

    uBitManager "1" *-- "*" uBit

    %%link uBitManager "./docs/docs/uBitManager.html" "Link"
    %%link uBit "./docs/docs/uBit.html" "Link"
```

## Verbindungsprozess

### Passwortüberprüfung

Wenn kein Passwort erforderlich ist oder ein gültiges Passwort bereits gespeichert wurde, wird nach der Verbindung direkt mit dem Abruf aller neuen Daten fortgefahren (siehe Abschnitt „Nach Sicherheitsfreigabe“). Andernfalls muss `sendAuthorization()` aufgerufen werden, um ein Passwort zu übermitteln und Zugriff zu erhalten.

```
mermaid
flowchart TD
  id0([Verbunden])
  id1{Sicherheitsüberprüfung}
  id4([Nach Sicherheitsfreigabe])
  id5[Ereignis senden: unauthorized]
  id6[sendAuthorization]

  id0-->id1
  id1-- Autorisiert -->id4
  id1-- Nicht autorisiert -->id5
  id5-->id6
  id6-->id1
```

## Nach Sicherheitsfreigabe
# Nach erfolgreicher Autorisierung werden die seit der letzten Verbindung gesammelten Daten abgerufen.
```
flowchart TD
  id0([Nach Sicherheitsfreigabe])
  id1[Fordere alle neuen Daten seit letzter Verbindung an]
  id2[Warte auf Datenpaket]
  id3[Verarbeite Datenpaket]
  id4[Ereignis senden: Fortschritt]
  id4b["Ereignisse senden: row-updated (mehrere)"]
  id5{Alle Daten empfangen?}
  id6[Ereignis senden: data-ready]

  id0-->id1
  id1-->id2
  id2-->id3
  id3-->id4
  id4-->id4b
  id4b-->id5
  id5-- Nein -->id2
  id5-- Ja -->id6

```

Während des Datenabrufs werden mehrere progress- und row-updated-Ereignisse ausgelöst. Die UTC-Zeitstempel sind erst bekannt, wenn alle Daten vollständig empfangen wurden (nach dem Ereignis data-ready).

```
flowchart TD
  id0([Nach Verbindung])
  id1[Warte auf data-ready]
  id2[Zeichne alle vorhandenen Daten]
  id3[Listener für row-update hinzufügen]
  id4[Warte auf row-update]
  id5["Aktualisiere Graph mit neuen Zeilen"]
  
  id0-->id1
  id1-->id2
  id2-->id3
  id3-->id4
  id4-->id5
  id5-->id4

```

## Abläufe

### Verbindung

```
mermaid
sequenceDiagram
  participant Frontend
  participant uBitManager 

Frontend ->>+uBitManager: connect()
loop Bis alle neuen Daten empfangen sind
  uBitManager -->>Frontend: Ereignis: progress
  loop Für jede aktualisierte Zeile
    uBitManager -->>Frontend: Ereignis: row-updated
  end
end
uBitManager -->>Frontend: Ereignis: data-ready
```

# Sicherheitszugriff

```
sequenceDiagram
  participant Frontend
  participant uBitManager 

Frontend ->>uBitManager: connect()
uBitManager -->>Frontend: Ereignis: unauthorized
Frontend ->>uBitManager: sendAuthorization()
```

Wenn das Passwort ungültig ist, wird erneut ein unauthorized-Ereignis ausgelöst. Andernfalls wird mit dem Abruf der Daten vom Calliope mini fortgefahren.

## JSDocs: Dokumentation der Funktionen [JSDocs hier ansehen](https://calliope-edu.github.io/webblelog/docs/index.html)

```
jsdoc ubitwebblelog.js -r jsdoc.md -d docs
```

Siehe [`index.html`](./index.html) für eine vollständige Beispielanwendung.

## TODO-Log

 Dokumentation / Ablaufdiagramme fertigstellen
 Test des persistenten Speichers abschließen und aktivieren
 Weitere Tests durchführen
 Mehrere Geräte: Funktioniert anscheinend gut
 Versuch, den initialen Download zu beschleunigen:
 https://punchthrough.com/ble-throughput-part-4/
 Hinweis: Die Kopfzeile muss Time enthalten und die Zeiteinheit muss in Sekunden angegeben sein





# Overview

This provides an API for interacting with the Calliope mini V3 log over Bluetooth via WebBLE.  It also includes a demo application to show how it works.
Based on the extension from https://github.com/bsiever

# Files / Manifest
* `ubitwebblelog.js`: The actual API (the only file needed for other applications)
* Demo application (a web-based console that shows the different messages)
  * [`index.html`](https://github.com/calliope-edu/webblelog/blob/master/index.html):  HTML with in-line JavaScript for the application
    * [View Live Version](https://calliope.github.io/webblelog/) *Only works in Chrome*
    * [View Local Live Version](./index.html) *Only works in Chrome*
  * `style.css`
  * Requires `ubitwebblelog.js`
* Documentation files
  * [`readme.md`](https://github.com/bsiever/microbit-webblelog/blob/master/readme.md): Overview of project
  * [`docs`](https://bsiever.github.io/microbit-webblelog/docs/): Directory including JSDoc documentation
    * `jsdoc.md`: Initial page / readme for JSDocs
  * `_config.yml`: GitHub pages config
  * [`LICENSE`](./LICENSE): MIT License

## Calliope mini V3 configuration 

* Go to https://makecode.calliope.cc
* Create a new project
* Add the BLELog extension
  * + Extensions
  * Paste the URL: https://github.com/calliope-edu/pxt-blelog in the search field and hit enter
  * Click on the tile to add the extension.
  * You'll asked to confirm removal of the `radio` blocks (and add this extension).  Click on the `Remove ...` button.
* Add the `Data Logger Bluetooth`'s `bluetooth data logger service` to the `on start` handler
* Add `data logger`'s `set columns` to the `on start` handler too.  
  * Add in the names of the fields (columns) 
* Add other handlers that support data points and/or erasing the log. 

```
input.onButtonPressed(Button.A, function () {
    datalogger.log(
    datalogger.createCV("x", input.acceleration(Dimension.X)),
    datalogger.createCV("y", input.acceleration(Dimension.Y))
    )
})
input.onButtonPressed(Button.AB, function () {
    datalogger.deleteLog(datalogger.DeleteType.Fast)
})
blelog.startBLELogService()
datalogger.setColumnTitles(
"x",
"y"
)
```

# API

## Objects

* `uBitManager`:  A single `uBitManager` should be created for any application.  It is used to connect to and manage available Calliope mini data loggers.  All events for individual micro:bits are sent via the manager.
* `uBit`: A single micro:bit object.  It provides operations to change its label, refresh all it's data, remove it, etc. 

A typical application will:

1. Create a single `uBitManager` instance.
2. Register with it for events of interest.
3. Allow users to call the `uBitManager`'s `connect()` to connect to micro:bit data loggers.
4. Allow interactions via:
   * Responding to any incoming events (i.e., graph or log data)
   * Allowing users to call operations on individual Calliope mini (`refresh()` data, `erase()`, etc.) 

## Class Diagrams

```
mermaid
classDiagram
    class uBitManager {
      +(async) void  connect()
      +Map(any:uBit) getDevices() 
    }

    class uBit {
      +void  disconnect()
      +string getLabel()
      +void setLabel()
      +[string] getCSV()
      +[string] getRawCSV()
      +[string] getHeaders()
      +[[string]] getData(start, end)
      +int getDataLength()
      +void sendErase()
      +void sendAuthorization(string)
      +void refreshData()
      +void remove()
    }

    uBitManager "1" *-- "*" uBit

    %%link uBitManager "./docs/docs/uBitManager.html" "Link"
    %%link uBit "./docs/docs/uBit.html" "Link"
```

## Connection Process

### Checking Password

If a password is not needed or a successful password is already saved, after connection it will proceed on to retrieve all new data (After Security Confirmation process).  Otherwise the `sendAuthorization()` must be used to send a password to get access.

```
mermaid
flowchart TD
  id0([Connected])
  id1{Check security}
  id4([After Security Confirmation])
  id5[Send event: unauthorized]
  id6[sendAuthorization]

  id0-->id1
  id1-- Authorized -->id4
  id1-- Unauthorized -->id5
  id5-->id6
  id6-->id1
```

### After Security Confirmation

After gaining authorization to access data, the data that was acquired since the last connection is retrieved.

```
mermaid
flowchart TD
  id0([After Security Confirmation])
  id1[Request all new data since last connection]
  id2[Wait for chunk of data]
  id3[Process chunk of data]
  id4[Send event: progress]
  id4b["Send events: row-updated (multiple)"]
  id5{Done getting data?}
  id6[Send event: data-ready]

  id0-->id1
  id1-->id2
  id2-->id3
  id3-->id4
  id4-->id4b
  id4b-->id5
  id5-- No -->id2
  id5-- Yes -->id6
```

Multiple `progress` and `row-updated` events will occur while data is being retrieved.  The UTC timestamps will not be known until all data has been retrieved (after `data-ready`).

## An approach for graphing

```
mermaid
flowchart TD
  id0([After Connect])
  id1[Wait for data-ready]
  id2[Graph all existing data]
  id3[Add listener for row-update]
  id4[Wait for row-update]
  id5["Update graph with new row(s)"]
  
  id0-->id1
  id1-->id2
  id2-->id3
  id3-->id4
  id4-->id5
  id5-->id4
```


## Sequences

### Connection

```
mermaid
sequenceDiagram
  participant Front end
  participant uBitManager 

Front end ->>+uBitManager: connect()
loop Until all new data received
  uBitManager -->>Front end: Event:progress
  loop Each updated row
  uBitManager -->>Front end: Event:row-updated
  end
end
uBitManager -->>Front end: Event: data-ready
```

## Security access

```
mermaid
sequenceDiagram
  participant Front end
  participant uBitManager 

Front end ->>uBitManager: connect()
uBitManager -->>Front end: Event: unauthorized
Front end ->>uBitManager: sendAuthorization()
```

If the password is invalid there will be another `unauthorize` event.  Otherwise it will proceed to retrieve data from the micro:bit.

## JSDocs: Documentation on the functions

[JSDocs Here](https://calliope-edu.github.io/webblelog/docs/index.html)

### Regenerate

```
jsdoc ubitwebblelog.js -r jsdoc.md -d docs
```

## Example

See [`index.html`](./index.html) for a complete example application.

# TODO Log

* Finish docs / sequence diagrams
* Finish testing persistent storage and enable it.
* More testing.
  * Multiple devices: Seems good
* Try to speed up initial download:
  * https://punchthrough.com/ble-throughput-part-4/
* Note that headers _must_ include "Time" and unit of time must be seconds
