# Trimandir Canteen

Offline-first tablet app built with Expo and React Native. Orders, inventory purchases, and reports are stored locally in SQLite; no backend is required.

## Development

Run Metro from the app directory so it uses that directory's installed dependencies:

```sh
cd canteen-app
npm install
npx expo start --port 8082
```

If Metro has stale cached code, clear its cache once with `npx expo start --port 8082 --clear`.

The root Expo project contains the EAS build configuration. Run cloud builds from the repository root, for example:

```sh
npx eas-cli build --profile preview --platform android
```

## Features

- Create and manage menu items and prices.
- Create orders, assign daily receipt tokens, review order history, and print receipts.
- Record inventory purchases by date, quantity, unit (kg or item number/packets), and total price.
- Review daily sales and compare sales with inventory costs over a selected date range.
- Configure Wi-Fi or Bluetooth printer settings and a starting receipt serial number per device.

Printer integrations use native modules. Use a development or production build for printer features; Expo Go does not include those native modules.

## Local data

SQLite database `canteen.db` is stored in the app's private device storage. Data stays on that device and is removed if the app is uninstalled unless backed up separately.
