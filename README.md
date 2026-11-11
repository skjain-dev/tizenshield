# TizenShield Browser

A remote-friendly web browser for Samsung Tizen TVs, delivered as a [TizenBrew](https://github.com/reisxd/TizenBrew)
site-modification module, with Brave-style ad and tracker blocking compiled from the same filter lists Brave uses.

Not affiliated with Brave Software. It doesn't use Brave's code, just the public filter lists Brave ships.

## Install on the TV

In TizenBrew's module manager choose **Add GitHub Module**, enter `skjain-dev/tizenshield`, then launch **TizenShield Browser**.

## Using it

It opens on **Home**: big tiles for video, news, sports and everyday sites, plus a search tile if you do want to type.
Move between tiles with the arrows and press OK.

**Your own tiles**, all from the remote:
- On any website: Red → **Add to Home**, then confirm the "Add … to Home?" tile on Home.
- On Home: type a site into **Add a website** (e.g. `example.com`).
- Remove: highlight any tile on Home and press **Yellow**. Removed built-in tiles come back with **Restore tiles**.

Your tiles are stored on the TV, in the Home page's own storage.

On a website:

| Key | Action |
|---|---|
| Arrows | Jump to the nearest link or button in that direction; with nothing there, the page scrolls |
| OK | Open / press what's highlighted. On a text field, opens the TV keyboard |
| Return | Back (or leaves a text field) |
| Red | Menu: Home, Back to page, Close pop-ups, Add to Home, Shields, Pointer, Reload, Search |
| Green | Close pop-ups: hides overlays covering the page and unlocks scrolling |
| CH ▲ / CH ▼ | Page up / page down |

**Shields** (per site): blocks requests to ad and tracker hosts, hides ad elements, and bounces back from pages on ad
networks. Turn it off from Home if a site breaks. **Pointer** (per site): turn it off on TV-native sites that drive
themselves with the remote.

The tiles skip DRM services (Netflix, Prime, Hotstar, Spotify): the TV's web engine has no Widevine or PlayReady, so
they can't play in a browser on it.

## What it can't do

A TizenBrew module is a script running inside the TV's web engine, not a browser of its own, so:
- Blocking happens inside the page (fetch, XHR, beacons, script/iframe/img sources). Requests the page fires before the
  script is injected still go out. Pair it with DNS blocking (e.g. AdGuard DNS on the TV) for full coverage.
- No tabs, extensions, sync, or fingerprinting protection.
- Third-party detection guesses the site's base domain instead of using the Public Suffix List.

## Build

```bash
node build.mjs   # Brave's installed lists (macOS) + lists/*.txt -> dist/userScript.js
node --test test/*.test.mjs  # compiler unit tests
node test/e2e.mjs  # injects the build into headless Brave exactly as TizenBrew does
```

`dist/userScript.js` is committed, because TizenBrew loads it straight from the repo through jsDelivr.

## Licence

GPL-3.0. The bundled filter data comes from EasyList and EasyPrivacy (GPLv3 / CC BY-SA 3.0), uBlock Origin's filters
(GPLv3), and Brave's lists (MPL-2.0).
