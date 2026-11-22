# APRSBox Lite

Lekki klient APRS dla systemów Windows, macOS i Linux. Pozwala śledzić stacje na mapie, przeglądać ruch i prowadzić rozmowy przez radio lub APRS-IS.

**[Pobierz najnowszą wersję](https://github.com/SQ9MDD/APRSBoxlite/releases)**

## Możliwości

- Mapa stacji APRS z symbolami, śladami ruchu, zasięgami PHG i siatką lokatorów Maidenhead.
- Lista stacji, szczegóły odebranych ramek oraz Traffic Monitor z filtrowaniem i zapisem logu.
- Wiadomości APRS z potwierdzeniami ACK, ponawianiem i grupami RF oraz APRS-IS. Historia rozmów jest zachowywana po restarcie.
- Konfiguracja własnej stacji i automatyczne lub ręczne wysyłanie beaconów.
- Interfejsy KISS TCP, KISS Serial, KISS Bluetooth LE oraz APRS-IS.
- Opcjonalny iGate **RF → APRS-IS**; kierunek APRS-IS → RF nie jest obecnie dostępny.
- Własne źródła map, opcjonalne buforowanie kafelków oraz jasny i ciemny motyw.

## Pobieranie

Na stronie [Releases](https://github.com/SQ9MDD/APRSBoxlite/releases) znajdują się instalator i wersja przenośna dla Windows x64, aplikacja dla macOS ARM64 oraz pakiety DEB i RPM dla Linux x64.

Po uruchomieniu skonfiguruj znak i pozycję w **Settings → My Station**, a następnie dodaj wybrany interfejs. Aby pracować przez radio, potrzebny jest zgodny TNC lub urządzenie KISS; APRS-IS wymaga połączenia z Internetem.

## Uruchomienie ze źródeł

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

Autorem projektu jest **Rysiek Labus, SQ9MDD**.
