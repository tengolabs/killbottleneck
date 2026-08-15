// Český jazykový balík — JEDEN dynamický chunk (viz index.js: do vstupního
// bundlu se jazyky nebalí, načítá se jen aktivní).
import common from './cs/common.json';
import nav from './cs/nav.json';
import auth from './cs/auth.json';
import home from './cs/home.json';
import editor from './cs/editor.json';
import tasks from './cs/tasks.json';
import myday from './cs/myday.json';
import notify from './cs/notify.json';
import errors from './cs/errors.json';
import lite from './cs/lite.json';

export default { common, nav, auth, home, editor, tasks, myday, notify, errors, lite };
