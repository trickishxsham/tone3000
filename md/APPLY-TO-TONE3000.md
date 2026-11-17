# Apply the Build 987 HTML-first files

Copy the contents of the `tone3000/` folder in this package into the root of the `trickishxsham/tone3000` repository, preserving directory paths and replacing the existing files:

- `app-latest.html`
- `builds/app-987.html`
- `builds/app-latest.html`
- `modules/rig/rig.js`
- `modules/nam/nam.js`

Copy `tests/rig-audio.test.cjs` into the repository's `tests/` folder. Run it from the repository root with:

```bash
node --test tests/rig-audio.test.cjs
```

The two `app-latest.html` copies and `builds/app-987.html` are intentionally byte-for-byte identical. Keep them that way when continuing HTML development.
