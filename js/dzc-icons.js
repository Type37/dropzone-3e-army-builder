/* Material Symbols, inlined.
 *
 * Copyright Google LLC. Used under the Apache License, Version 2.0:
 * https://www.apache.org/licenses/LICENSE-2.0
 * Attribution also appears in the app, under Settings -> About.
 *
 * The six stat_* paths are NOT Material — they are drawn for this app.
 *
 * INLINED ON PURPOSE. Loading an icon font or SVG sprite from a CDN would
 * break the app at a table with no signal, which is the one place it has to
 * work. Same reasoning as the mobile app's existing ICON_PATHS map.
 *
 * All paths are Material Symbols / Material Icons on a 24x24 viewBox, Apache
 * 2.0. See ICONS.md for the review list, what each one is used for, and which
 * ones are placeholders awaiting a better pick.
 *
 *   DZCIcon('add')                  -> <svg>…</svg>
 *   DZCIcon('delete', { size: 18 }) -> sized
 */
(function () {
  'use strict';

  const P = {
    // — actions —
    add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    remove: 'M19 13H5v-2h14v2z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    arrow_back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    content_copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
    more_vert: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    print: 'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z',
    share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z',
    // Supplied by Jet. A cog with a real aperture rather than Material's
    // filled-in one, and its own 26-unit box.
    settings: {
      box: '0 0 26 26',
      d: 'm11.469.969l-.563 3.562A8.7 8.7 0 0 0 8.5 5.5L5.562 3.406L3.438 5.531L5.5 8.47a8.8 8.8 0 0 0-1 2.406l-3.531.594v3l3.531.625a8.7 8.7 0 0 0 1 2.406l-2.094 2.938l2.125 2.125L8.47 20.5a8.7 8.7 0 0 0 2.406.969l.594 3.562h3l.656-3.562a8.6 8.6 0 0 0 2.375-1l2.969 2.093l2.125-2.125L20.47 17.5c.438-.73.79-1.526 1-2.375l3.562-.656v-3l-3.562-.594a8.8 8.8 0 0 0-1-2.375l2.093-2.969l-2.125-2.125L17.5 5.531a8.8 8.8 0 0 0-2.406-1L14.469.97zM13 6.469A6.535 6.535 0 0 1 19.531 13A6.535 6.535 0 0 1 13 19.531A6.536 6.536 0 0 1 6.469 13A6.536 6.536 0 0 1 13 6.469m0 1.593A4.95 4.95 0 0 0 8.062 13A4.95 4.95 0 0 0 13 17.938A4.95 4.95 0 0 0 17.938 13A4.95 4.95 0 0 0 13 8.062m-.031 2.876c1.146 0 2.094.915 2.094 2.062s-.948 2.063-2.094 2.063A2.054 2.054 0 0 1 10.906 13c0-1.147.917-2.063 2.063-2.063z'
    },

    // — status —
    error: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
    warning: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    check_circle: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z',

    // — stats —
    // Geometric, not pictorial, and deliberately echoing the Dropfleet stat
    // language: an arrow for movement, a hexagon for the damage track. Armour
    // and Defence are a solid vs an outline shield so the pair reads as one
    // idea with two weights.
    // Move — a route between two nodes. Supplied by Jet.
    stat_mv: {
      box: '0 0 512 512',
      d: 'M426.667 96c0 5.891-4.777 10.667-10.667 10.667S405.333 101.891 405.333 96S410.11 85.333 416 85.333S426.667 90.11 426.667 96m42.666 0c0 29.455-23.878 53.333-53.333 53.333S362.667 125.455 362.667 96S386.545 42.667 416 42.667S469.333 66.545 469.333 96M106.667 416c0 5.89-4.776 10.667-10.667 10.667c-5.89 0-10.667-4.777-10.667-10.667S90.11 405.333 96 405.333s10.667 4.777 10.667 10.667m42.666 0c0 29.455-23.878 53.333-53.333 53.333S42.667 445.455 42.667 416S66.545 362.667 96 362.667s53.333 23.878 53.333 53.333M320 222.17L164.418 377.751l-30.17-30.169L289.83 192h-55.163v-42.667h128v128H320z'
    },
    // Infantry move on foot, so they get a shoe rather than a route.
    // Phosphor sneaker-move-fill, MIT, inlined at author time.
    stat_mv_infantry: {
      box: '0 0 256 256',
      d: 'M70.8 184H32a8 8 0 0 1 0-16h38.8a8 8 0 1 1 0 16m32 16H48a8 8 0 0 0 0 16h54.8a8 8 0 1 0 0-16m128.36-33.37l-28.63-14.31A47.74 47.74 0 0 1 176 109.39V80a8 8 0 0 0-7.93-8A48.05 48.05 0 0 1 120 24.07a8 8 0 0 0-12.83-6.44L45.11 64.68a4 4 0 0 0-.41 6l51.44 51.44a8.19 8.19 0 0 1 .6 11.09a8 8 0 0 1-11.71.43l-53-53a4 4 0 0 0-6.44 1.09a16 16 0 0 0 3.12 18.22L142.4 213.66a8 8 0 0 0 5.66 2.34H224a16 16 0 0 0 16-16v-19.06a15.92 15.92 0 0 0-8.84-14.31'
    },
    /* Armour, supplied by Jet 2026-08-07: plate over a ribcage, on a 512 grid.
       The shield it replaces was a UI shield -- the mark for "protected" in
       every app ever built -- which said security rather than armour. */
    stat_a: {
      box: '0 0 512 512',
      d: 'M156.7 25.83L89 39.38c-.1 58.57-1.74 119.32-43.49 167.22C104.4 246.5 189 260.7 247 248.8v-99L108.3 88.22l7.4-16.44L256 134.2l140.3-62.42l7.4 16.44L265 149.8v99c58 11.9 142.6-2.3 201.5-42.2c-41.8-47.9-43.4-108.65-43.5-167.22l-67.7-13.55c-12.9 13.88-20.6 28.15-32.9 40.53C308.9 79.78 289.5 89 256 89s-52.9-9.22-66.4-22.64c-12.3-12.38-20-26.65-32.9-40.53M53.88 232.9C75.96 281 96.07 336.6 102.7 392.8l65 22.8c4.2-52.7 28.2-104 63.7-146.1c-55.1 6.3-122.7-5.8-177.52-36.6m404.22 0c-54.8 30.8-122.4 42.9-177.5 36.6c35.5 42.1 59.5 93.4 63.7 146.1l65.2-22.9c6.6-56.8 26.6-111.8 48.6-159.8M256 269c-40.5 43.1-67.7 97.9-70.7 152.7l61.7 21.6V336h18v107.3l61.7-21.6c-3.1-54.8-30.2-109.6-70.7-152.7m151.7 143.4L297 451.1v18.8l110.2-44.1c.1-4.5.3-8.9.5-13.4m-303.3.1c.3 4.5.4 8.9.5 13.4l110.1 44v-18.7zM279 457.4l-23 8.1l-23-8v19.6l23 9.2l23-9.2z'
    },
    stat_dp: 'M12 2 21 7v10l-9 5-9-5V7l9-5z',
    // Power — a Behemoth's activation currency (Behemoth rules 1.2). A bolt,
    // because it is spent and replenished rather than compared: the other five
    // stats say what a Unit IS, this one says what it has left.
    stat_power: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
    // Offence — a soldier firing. Supplied by Jet; carries its own 640 box.
    stat_of: {
      box: '0 0 640 640',
      d: 'M480 64h-32c-8.8 0-16 7.2-16 16s7.2 16 16 16v100.3c-9.6 5.5-16 15.9-16 27.7v32c-17.7 0-32 14.3-32 32v144c0 17.7 14.3 32 32 32h16v96c0 8.8 7.2 16 16 16h59.5c10.4 0 18-9.8 15.5-19.9L516 464h44c8.8 0 16-7.2 16-16v-16c0-8.8-7.2-16-16-16h-48v-26.7l53.1-17.7c6.5-2.2 10.9-8.3 10.9-15.2v-84.5c0-8.8-7.2-16-16-16h-16c-8.8 0-16 7.2-16 16v56l-16 5.3V223.9c0-11.8-6.4-22.2-16-27.7V80c0-8.8-7.2-16-16-16M288 272c-106 0-192 86-192 192v48c0 17.7 14.3 32 32 32s32-14.3 32-32v-48c0-32.5 12.1-62.1 32-84.7V576h160V282.9c-20-7.1-41.6-10.9-64-10.9m56-120c0-39.8-32.2-72-72-72s-72 32.2-72 72s32.2 72 72 72s72-32.2 72-72'
    },
    stat_df: 'M12 2 4 5.5v5.9c0 4.9 3.4 9.5 8 10.6 4.6-1.1 8-5.7 8-10.6V5.5L12 2zm0 2.2 6 2.6v4.6c0 3.8-2.5 7.4-6 8.5-3.5-1.1-6-4.7-6-8.5V6.8l6-2.6z',
    // Bravery — a banner. Phosphor flag-banner-fold-fill, MIT, inlined from
    // the Iconify API at author time. Never fetched at runtime: a CDN icon is
    // a blank square at a table with no signal.
    stat_b: {
      box: '0 0 256 256',
      d: 'm131.79 69.65l-43.63 96a4 4 0 0 1-3.64 2.35H28.23a8.2 8.2 0 0 1-6.58-3.13a8 8 0 0 1 .43-10.25L57.19 116L22.08 77.38a8 8 0 0 1-.43-10.26A8.22 8.22 0 0 1 28.23 64h99.92a4 4 0 0 1 3.64 5.65m105.77-27.41a8.3 8.3 0 0 0-5.79-2.24H168a8 8 0 0 0-7.28 4.69l-42.57 93.65a4 4 0 0 0 3.64 5.66h57.79l-34.86 76.69a8 8 0 1 0 14.56 6.62l80-176a8 8 0 0 0-1.72-9.07'
    },

    // — domain —
    // Group / activation unit. "layers" reads as a stack of things acting together.
    layers: 'M11.99 18.54 4.62 12.81 3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z',
    // Transport. Material "local_shipping".
    local_shipping: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9 1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
    /* Raw Materials, supplied by Jet 2026-08-08. Bioficer RM tokens are
       organic matter reclaimed off the battlefield, so it is a cell cluster
       and not a crate or a cog -- nothing in Material says "biomass".
       Its own 512 box, and the source's `fill="none"` background rect is
       dropped: DZCIcon paints one path in currentColor. */
    rm: {
      box: '0 0 512 512',
      d: 'M193.24 19.008c-39.99.03-90.725 18.933-136.98 73.293c-42.623 50.09-43.956 96.654-26.955 130.233c16.154 31.91 49.733 51.928 83.863 50.05a136 136 0 0 1 2.49-3.075a144 144 0 0 1 4.973-5.63l9.415-13.358c-11.113-4.64-20.094-11.292-26.785-19.377c-10.676-12.9-15.37-29.04-15.246-45.217c.244-32.353 18.907-65.897 50.19-81.666c11.97-6.034 24.344-8.83 36.542-9.024c17.343-.273 34.322 4.732 49.28 13.174c6.798-22.15 22.078-39.673 41.333-51.707c-2.25-8.447-8.483-16.68-18.71-23.467c-12.038-7.987-29.3-13.57-49.574-14.173a125 125 0 0 0-3.836-.055zm147.996 35.508c-22.5.316-44.8 5.874-62.57 15.996c-19.727 11.237-33.782 27.5-38.28 49.093c12.067 9.827 22.26 21.963 29.555 35.385a46.8 46.8 0 0 1 9.134-10.39c11.407-9.61 26.41-13.88 41.313-13.82c14.902.062 29.985 4.45 41.77 13.773a50.74 50.74 0 0 1 17.564 26.703c16.263-15.822 37.02-23.22 57.08-23.04c4.85.044 9.654.546 14.348 1.462c-.035-27.86-9.53-48.44-24.28-63.62c-17.65-18.17-43.575-28.536-70.86-30.99a142 142 0 0 0-14.772-.551zm-165.87 59.28c-9.606.146-19.3 2.388-28.75 7.15c-24.218 12.21-39.725 40.084-39.915 65.12c-.094 12.52 3.43 24.066 10.956 33.16c7.526 9.095 19.21 16.14 37.235 18.83h.003c39.574 5.908 82.127 9.612 116.025 27.868c33.898 18.255 57.493 52.813 56.3 112.822c-.868 43.678 24.482 67.034 59.085 69.498h.002c19.04 1.36 39.016-14.747 46.504-32.055c3.742-8.654 4.214-16.855 1.68-22.807s-7.93-11.126-20.965-13.76l.024-.12a63.4 63.4 0 0 1-17.07-6.023c-16.734-8.785-28.737-24.21-35.093-41.584c-6.357-17.372-7.19-36.947-.66-54.644c6.528-17.697 20.85-33.24 42.79-41.17c8.17-2.953 16.144-4.486 23.797-4.805c23.534-.98 44.027 9.512 57.936 25.38c13.79-23.95 7.996-59.225-13.37-77.257h-.003c-24.878-20.997-72.19-18.427-93.607 25.56c-3.247 9.45-8.724 17.39-15.586 23.38c-10.917 9.528-24.99 14.332-39.108 14.64c-14.118.31-28.494-3.886-39.974-13.093s-19.725-23.583-21.36-41.75q0-.025-.004-.05c-4.264-22.568-20.17-45.425-41.107-59.532c-13.99-9.43-29.756-15.005-45.765-14.76zM320.31 149.47c-11.18-.045-22.01 3.368-29.197 9.423c-7.188 6.054-11.454 14.276-10.258 27.568v.003c1.228 13.645 6.782 22.704 14.44 28.846c7.658 6.14 17.763 9.208 27.873 8.987c10.11-.22 20.013-3.74 27.227-10.037c7.213-6.296 12.077-15.165 12.435-28.06c.347-12.515-4.45-20.804-12.27-26.99c-7.818-6.184-19.07-9.693-30.25-9.74m111.083 100.186c-6.72.005-13.922 1.254-21.526 4.002c-17.23 6.23-26.834 17.125-31.607 30.063c-4.773 12.94-4.285 28.194.678 41.757c4.962 13.562 14.274 25.18 26.23 31.457s26.617 7.814 44.85.226c18.36-7.642 28.286-19.104 32.937-31.795c4.65-12.69 3.814-27.015-1.46-39.84c-7.91-19.237-24.69-34.61-47.253-35.795q-1.41-.075-2.85-.074zm-274.05 7.643c-10.213 6.585-19.498 14.807-27.35 24.196c-17.158 20.52-27.33 46.345-26.304 71.936c1.027 25.59 12.765 51.3 41.572 73.33c28.917 22.114 57.135 27.782 82.322 23.398s47.588-19.206 63.344-39.63c7.505-9.727 13.508-20.607 17.605-32.128v-.027c1.1-55.318-17.576-80.434-46.476-95.998c-27.654-14.893-66.18-19.45-104.715-25.078zm-119.345 6.647c-17.504 21.283-15.83 46.66-4.68 66.543c11.265 20.09 31.345 32.706 51.97 28.002a106 106 0 0 1-.272-4.31c-.89-22.146 5.054-43.816 15.732-63.008c-23.247-1.824-45.287-11.65-62.75-27.227m275.188 147.24c-2.31 3.714-4.8 7.308-7.46 10.758c-16.392 21.247-39.18 37.576-65.53 44.557c7.864 17.405 27.497 26.744 48.827 26.312c23.31-.47 46.56-12.385 55.635-39.52c-14.386-9.634-25.56-23.998-31.472-42.106z'
    },
    // Commander. Material "military_tech".
    /* Commander, supplied by Jet 2026-08-07: a chain of command, not a medal.
       The medal was a rank badge; this says what a Commander DOES to a Group. */
    military_tech: 'M20.01 10.99h-7v-2h-2v2H3.47v4h2v-2h5.54v2h2v-2h5.5v2h2v-4zM12.01 2.01a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.47 16.99a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM12.01 16.99a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM19.51 16.99a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    /* Two grab handles, both Jet's. Six dots in a 2x3 for a Group -- a whole
       row you pick up -- and the scattered six for a Squad, so the two grips
       do not read as the same control at two sizes. */
    /* A die, for the Attacks column. Jet 2026-08-07: attacks read "5d6",
       because that is what the number is -- how many dice you roll. Two paths
       on a 32 grid, kept as one entry so the pips travel with the cube. */
    dice: {
      box: '0 0 32 32',
      d: 'M7.988 13.877c.104 1.1-.483 2.054-1.303 2.12c-.82.065-1.57-.773-1.673-1.873c-.104-1.101.483-2.054 1.303-2.12c.82-.073 1.57.764 1.673 1.873m4.698 12.119c.82-.065 1.406-1.018 1.302-2.119c-.103-1.109-.854-1.946-1.673-1.872c-.82.065-1.407 1.018-1.303 2.119c.103 1.1.854 1.938 1.673 1.872m13.001-13.992c.82.065 1.406 1.018 1.302 2.119c-.103 1.109-.854 1.946-1.674 1.873c-.82-.066-1.406-1.019-1.302-2.12c.103-1.1.854-1.938 1.674-1.872m-1.698 7.119c.104-1.1-.483-2.054-1.302-2.12c-.82-.065-1.57.773-1.674 1.873s.483 2.054 1.302 2.12c.82.073 1.57-.764 1.674-1.873m-4.302 2.881c.82.065 1.406 1.018 1.302 2.119c-.103 1.109-.854 1.946-1.674 1.872c-.82-.065-1.406-1.018-1.302-2.119c.103-1.1.854-1.938 1.674-1.872M13.883 2.451L4.494 6.504q-.329.148-.59.39A2.5 2.5 0 0 0 2 9.324v14.17a3 3 0 0 0 1.795 2.747l9.701 4.253c.297.13.6.198.9.21a4.5 4.5 0 0 0 3.209 0c.298-.012.602-.08.899-.21l9.7-4.253A3 3 0 0 0 30 23.493V9.323a2.5 2.5 0 0 0-1.782-2.396a2 2 0 0 0-.61-.423l-9.49-4.053a5.2 5.2 0 0 0-4.235 0M15 14.81v13.396a.5.5 0 0 1-.7.457L4.597 24.41A1 1 0 0 1 4 23.493V9.323a.5.5 0 0 1 .706-.455l9.117 4.118A2 2 0 0 1 15 14.81m2 13.396V14.808a2 2 0 0 1 1.177-1.823l9.117-4.118a.5.5 0 0 1 .706.456v14.17a1 1 0 0 1-.598.915L17.7 28.662a.5.5 0 0 1-.701-.457M16 7.5c-1.657 0-3-.448-3-1s1.343-1 3-1s3 .448 3 1s-1.343 1-3 1'
    },
    drag_rows: 'M3.25 4.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zm8.25 0a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zm8.25 0a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zM3.25 12.25a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zm8.25 0a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zm8.25 0a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z',
    drag_dots: 'M15 19.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0-6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm-6 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm7.5-13.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM10.5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM9 7.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
    // Army / roster list.
    list_alt: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 11h2v2H7zm0-4h2v2H7zm0 8h2v2H7zm4-8h6v2h-6zm0 4h6v2h-6zm0 4h6v2h-6z',
    grid_view: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    // Points / cost.
    calculate: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM7 7h4v2H7V7zm10 10h-4v-2h4v2zm0-4h-4v-2h4v2zm-6 4H7v-2h4v2zm0-4H7v-2h4v2z',
    // Squads. Material "groups".
    groups: 'M4 13c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm1.13 1.1c-.37-.06-.74-.1-1.13-.1-.99 0-1.93.21-2.78.58C.48 14.9 0 15.62 0 16.43V18h4.5v-1.61c0-.83.23-1.61.63-2.29zM20 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm4 3.43c0-.81-.48-1.53-1.22-1.85-.85-.37-1.79-.58-2.78-.58-.39 0-.76.04-1.13.1.4.68.63 1.46.63 2.29V18H24v-1.57zM16.24 12.65c-1.17-.52-2.61-.9-4.24-.9-1.63 0-3.07.39-4.24.9C6.68 13.13 6 14.21 6 15.39V18h12v-2.61c0-1.18-.68-2.26-1.76-2.74zM12 10c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3z',
    // Models on the table. Material "deployed_code" — a single miniature reads
    // as one box you actually own and have to carry to the game.
    deployed_code: 'M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3 6.5 3.61L12 11.52 5.5 7.91 12 4.3zM5 9.6l6 3.33v6.47l-6-3.33V9.6zm8 9.8v-6.47l6-3.33v6.47l-6 3.33z'
  };

  /* Most paths are Material on a 24x24 grid. A few come from elsewhere and
   * carry their own box, so an entry may be either a path string or
   * { d, box }. */
  const BOX = '0 0 24 24';

  function icon(name, opts) {
    const o = opts || {};
    const e = P[name];
    if (!e) return '';
    const d = typeof e === 'string' ? e : e.d;
    const box = typeof e === 'string' ? BOX : (e.box || BOX);
    const s = o.size || 20;
    return `<svg class="dzc-i${o.className ? ' ' + o.className : ''}" width="${s}" height="${s}"`
      + ` viewBox="${box}" fill="currentColor" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
  }

  /* Firing arcs, drawn rather than spelled out.
   *
   * Dropzone arcs are 90-degree WEDGES (6.1.2) and split the sides into Left
   * and Right, so Dropfleet's arc icons carry over neither in shape nor in
   * vocabulary. Four quadrants of a circle, front at the top, with the covered
   * ones filled — "F/Sl" is instantly a different picture from "F/Sr", which
   * is the whole reason to draw it.
   *
   * Each wedge is inset 3 degrees from the diagonals it shares, so 84 degrees
   * of ink with 6 degrees of paper between. They used to meet exactly on the
   * diagonal, which meant two lit wedges fused into one shape with no boundary
   * at all — "F/S" read as a single 270-degree blob and told you nothing that
   * "F/S/R" did not. Uily spotted it: the separators were not visible enough.
   *
   * Cut into the geometry rather than drawn over it with a background-coloured
   * stroke, because the background is not one colour — paper, the tinted band
   * on a live row, the dark theme — and a gap is a gap on all of them.
   *
   * Endpoints are cos/sin on r=10 about (12,12), y inverted: 48 degrees gives
   * 12±6.69 and 12∓7.43, 42 degrees the same pair the other way round.
   */
  const WEDGE = {
    F: 'M12 12 L5.31 4.57 A10 10 0 0 1 18.69 4.57 Z',
    Sr: 'M12 12 L19.43 5.31 A10 10 0 0 1 19.43 18.69 Z',
    R: 'M12 12 L18.69 19.43 A10 10 0 0 1 5.31 19.43 Z',
    Sl: 'M12 12 L4.57 18.69 A10 10 0 0 1 4.57 5.31 Z'
  };

  const ARC_PARTS = {
    'F': ['F'],
    'F/S': ['F', 'Sl', 'Sr'],
    'F/S/R': ['F', 'Sl', 'Sr', 'R'],
    'F/Sl': ['F', 'Sl'],
    'F/Sr': ['F', 'Sr'],
    'F/R': ['F', 'R'],
    'S': ['Sl', 'Sr'],
    'R': ['R']
  };

  const ARC_LABEL = {
    F: 'Front', Sl: 'Side Left', Sr: 'Side Right', R: 'Rear'
  };

  /* Case-insensitively, because the Behemoth cards write "F/SL" and "F/SR"
     where every faction card writes "F/Sl" and "F/Sr". Same arc, different
     typesetting — and an arc is a code, not prose, so the capital is not
     carrying meaning. Matching exactly meant nine Behemoth weapons drew no
     arc at all. */
  const ARC_KEYS = Object.keys(ARC_PARTS).reduce((m, k) => {
    m[k.toLowerCase()] = ARC_PARTS[k];
    return m;
  }, {});

  function arc(spec, opts) {
    const key = String(spec || '').trim();
    const parts = ARC_KEYS[key.toLowerCase()];
    if (!parts) return '';
    const s = (opts && opts.size) || 20;
    const title = parts.map(p => ARC_LABEL[p]).join(', ');
    // An unlit wedge is drawn, not omitted: "which quarters" is only readable
    // against the ones it is not. At .18 it was close enough to nothing that
    // the icon read as a shape floating on its own.
    const wedges = Object.keys(WEDGE).map(k =>
      `<path d="${WEDGE[k]}" fill="currentColor"` +
      ` opacity="${parts.indexOf(k) !== -1 ? '1' : '.22'}"/>`).join('');
    return `<span class="dzc-arc" title="${title}" aria-label="Arc: ${title}">`
      + `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">`
      + `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>`
      + wedges
      + `</svg></span>`;
  }

  /* A stat's icon, by the key the stat cards print (Mv, A, DP, OF, DF, B).
   * Pass the unit type so Infantry get the shoe rather than the route. */
  icon.stat = (key, opts) => {
    const k = String(key || '').toLowerCase();
    const type = String((opts && opts.type) || '');
    const name = (k === 'mv' && /infantry/i.test(type)) ? 'stat_mv_infantry' : 'stat_' + k;
    return icon(name, opts);
  };

  /* The MOVE & ATTACK mark is gone (2026-08-10, Jet: "remove the M&A max
   * icon"). It was Jet's own drawing -- a gun vehicle firing on the move
   * over a double chevron, supplied as "Comic Page.zip" on 2026-08-07 --
   * and it was the only icon in the app carrying its own colours rather
   * than currentColor, which is what killed it: three inks at 13px in a
   * 57px stat column read as a smudge, and being fixed colours it could
   * not follow the dark theme with everything around it. The column still
   * says "M&A Max", which is the abbreviation Jet asked for on 2026-08-07
   * and the part that was doing the work. It is recoverable from git if a
   * bigger home for it ever turns up. */

  icon.has = n => Object.prototype.hasOwnProperty.call(P, n);
  icon.names = () => Object.keys(P);
  icon.arc = arc;
  icon.arcLabel = spec => (ARC_KEYS[String(spec || '').trim().toLowerCase()] || [])
    .map(p => ARC_LABEL[p]).join(', ');
  window.DZCIcon = icon;
})();
