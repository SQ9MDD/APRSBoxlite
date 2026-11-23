# APRSBox Lite

[Polski](#polski) · [English](#english)

## Polski

APRSBox Lite to lekki klient APRS inspirowany projektem [APRSBox](https://github.com/SQ9MDD/APRSBox), przeznaczony do szybkiego, doraźnego uruchomienia na komputerze. Pozwala śledzić stacje na mapie, przeglądać ruch i prowadzić rozmowy przez radio lub APRS-IS.

Wersja Lite skupia się na podstawowych funkcjach klienta i nie zawiera rozbudowanych możliwości DIGI i iGate dostępnych w pełnym APRSBox. Jest za to dostępna jako instalator lub gotowa paczka dla Windows, macOS i Linux, dzięki czemu można ją szybko uruchomić na różnych platformach.

**[Pobierz najnowszą wersję](https://github.com/SQ9MDD/APRSBoxlite/releases)**

### Możliwości

- Mapa stacji APRS z symbolami, śladami ruchu, zasięgami PHG i siatką lokatorów Maidenhead.
- Lista stacji, szczegóły odebranych ramek oraz Traffic Monitor z filtrowaniem i zapisem logu.
- Wiadomości APRS z potwierdzeniami ACK, ponawianiem i grupami RF oraz APRS-IS. Historia rozmów jest zachowywana po restarcie.
- Konfiguracja własnej stacji i automatyczne lub ręczne wysyłanie beaconów.
- Interfejsy KISS TCP, KISS Serial, KISS Bluetooth LE oraz APRS-IS.
- Opcjonalny iGate **RF → APRS-IS**; kierunek APRS-IS → RF nie jest obecnie dostępny.
- Własne źródła map, opcjonalne buforowanie kafelków oraz jasny i ciemny motyw.

### Pobieranie

Na stronie [Releases](https://github.com/SQ9MDD/APRSBoxlite/releases) znajdują się instalator i wersja przenośna dla Windows x64, aplikacja dla macOS ARM64 oraz pakiety DEB i RPM dla Linux x64.

Po uruchomieniu skonfiguruj znak i pozycję w **Settings → My Station**, a następnie dodaj wybrany interfejs. Aby pracować przez radio, potrzebny jest zgodny TNC lub urządzenie KISS; APRS-IS wymaga połączenia z Internetem.

### Uruchomienie ze źródeł

Wymagane są Node.js i npm. Projekt wykorzystuje Electron Forge, Vite, TypeScript i Leaflet.

```sh
npm ci
npm start
```

Przydatne polecenia:

```sh
npm run typecheck
npm run test:config
npm run package
```

---

## English

APRSBox Lite is a lightweight APRS client inspired by [APRSBox](https://github.com/SQ9MDD/APRSBox), designed for quick, occasional use on a computer. It lets you follow stations on a map, monitor traffic and exchange messages over radio or APRS-IS.

The Lite edition focuses on core client features and does not include the full DIGI and iGate capabilities of APRSBox. It is available as an installer or ready-to-run package for Windows, macOS and Linux, making it easy to get started on different platforms.

**[Download the latest release](https://github.com/SQ9MDD/APRSBoxlite/releases)**

### Features

- APRS station map with symbols, movement trails, PHG coverage and a Maidenhead locator grid.
- Station list, received packet details, and a Traffic Monitor with filtering and log export.
- APRS messages with ACKs, retries and separate RF and APRS-IS groups. Conversation history remains available after restart.
- Own-station settings and automatic or manual beacon transmission.
- KISS TCP, KISS Serial, KISS Bluetooth LE and APRS-IS interfaces.
- Optional **RF → APRS-IS** iGate; APRS-IS → RF is not currently available.
- Custom map sources, optional tile caching, and light and dark themes.

### Downloads

The [Releases](https://github.com/SQ9MDD/APRSBoxlite/releases) page provides a Windows x64 installer and portable package, a macOS ARM64 application, and DEB and RPM packages for Linux x64.

After starting the app, configure your callsign and position under **Settings → My Station**, then add an interface. Radio operation requires a compatible TNC or KISS device; APRS-IS requires an Internet connection.

### Running from source

Node.js and npm are required. The project uses Electron Forge, Vite, TypeScript and Leaflet.

```sh
npm ci
npm start
```

Useful commands:

```sh
npm run typecheck
npm run test:config
npm run package
```
