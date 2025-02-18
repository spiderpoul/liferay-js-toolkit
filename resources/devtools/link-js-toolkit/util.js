/**
 * © 2017 Liferay, Inc. <https://liferay.com>
 *
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

const spawn = require('cross-spawn');
const fs = require('fs');
const path = require('path');

const toolkitProjectNames = fs.readdirSync(
	path.join(__dirname, '..', '..', '..', 'packages')
);

function isToolkitDep(pkgName) {
	return toolkitProjectNames.indexOf(pkgName) != -1;
}

function safeRunFs(fn) {
	try {
		fn();
	} catch (err) {
		if (err.code !== 'EEXIST') {
			throw err;
		}
	}
}

function yarn(...args) {
	const proc = spawn.sync('yarn', args, {
		shell: true,
		stdio: 'inherit',
	});

	if (proc.error) {
		throw proc.error;
	} else if (proc.status != 0) {
		throw new Error(
			`'yarn ${args.join(' ')}' finished with status ${proc.status}`
		);
	} else if (proc.signal) {
		throw new Error(
			`'yarn ${args.join(' ')}' finished due to signal ${proc.signal}`
		);
	}
}

module.exports = {
	isToolkitDep,
	safeRunFs,
	yarn,
};
