# ????? ??????? store: website + server

A Node.js store with a SQLite database. Requires Node 22.5 or newer.

## Pages
- `/`: browse and search products, view product photos.
- `/admin`: password protected dashboard for products and categories. Categories can be added or removed when no products use them.

## Run it
On Windows, set `ADMIN_PASSWORD` in `start.bat`, then run it. The data directory is set there to preserve the existing database.

On Mac/Linux:

```sh
ADMIN_PASSWORD="long-password" npm start
```

Open `http://localhost:3000` for the store and `http://localhost:3000/admin` for administration.

## Products
In `/admin`, manage product names, categories, stock, status, photos, and descriptions.
