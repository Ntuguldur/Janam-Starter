# ????? ??????? store: website + server

A Node.js store with a SQLite database. Requires Node 22.5 or newer.

## Pages
- `/`: browse and search products, view product photos.
- `/manage-7f3c9a2e8b6d4f1a0c5e9b7d3a6f2c8e`: password protected dashboard for products and categories. Categories can be added or removed when no products use them.

## Run it
On Windows, set `ADMIN_PASSWORD` in `start.bat`, then run it. The data directory is set there to preserve the existing database.

On Mac/Linux:

```sh
ADMIN_PASSWORD="long-password" npm start
```

Open `http://localhost:3000` for the store and `http://localhost:3000/manage-7f3c9a2e8b6d4f1a0c5e9b7d3a6f2c8e` for administration. Set `ADMIN_PATH` to a different path if you want to choose your own; it must start with `/` and contain 16–100 letters, numbers, underscores, or hyphens. The old `/admin` and `/admin.html` URLs return 404.

## Products
In the admin page, manage product names, categories, stock, status, photos, and descriptions.
