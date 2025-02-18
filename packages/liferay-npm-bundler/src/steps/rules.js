/**
 * © 2017 Liferay, Inc. <https://liferay.com>
 *
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import fs from 'fs-extra';
import * as gl from 'liferay-npm-build-tools-common/lib/globs';
import PluginLogger from 'liferay-npm-build-tools-common/lib/plugin-logger';
import project from 'liferay-npm-build-tools-common/lib/project';
import path from 'path';

import * as config from '../config';
import * as log from '../log';
import report from '../report';
import {findFiles, getDestDir, runInChunks} from './util';

/**
 * Run configured rules.
 * @param {PkgDesc} rootPkg the root package descriptor
 * @param {Array<PkgDesc>} depPkgs dependency package descriptors
 * @return {Promise}
 */
export default function runRules(rootPkg, depPkgs) {
	const dirtyPkgs = [rootPkg, ...depPkgs].filter(srcPkg => !srcPkg.clean);

	return Promise.all(dirtyPkgs.map(srcPkg => processPackage(srcPkg))).then(
		() => log.debug(`Applied rules to ${dirtyPkgs.length} packages`)
	);
}

/**
 *
 * @param {PkgDesc} srcPkg
 * @param {number} chunkIndex
 * @return {Promise}
 */
function processPackage(srcPkg) {
	log.debug(`Applying rules to package '${srcPkg.id}'...`);

	const sourceGlobs = srcPkg.isRoot
		? project.sources.map(source => `${source.asPosix}/**/*`)
		: ['**/*'];

	const globs = [...sourceGlobs, '!node_modules/**/*'];

	const sourcePrjRelPaths = findFiles(
		project.dir.asNative,
		gl.prefix(`${project.dir.asPosix}/${srcPkg.dir.asPosix}/`, globs)
	);

	const destPkg = srcPkg.clone({
		dir: getDestDir(srcPkg),
	});

	return runInChunks(
		sourcePrjRelPaths,
		config.bundler.getMaxParallelFiles(),
		0,
		prjRelPath => processFile(srcPkg, destPkg, prjRelPath)
	);
}

/**
 *
 * @param {PkgDesc} srcPkg
 * @param {PkgDesc} destPkg
 * @param {string} prjRelPath
 * @return {Promise}
 */
function processFile(srcPkg, destPkg, prjRelPath) {
	const loaders = project.rules.loadersForFile(prjRelPath);

	if (loaders.length == 0) {
		return Promise.resolve();
	}

	const fileAbsPath = project.dir.join(prjRelPath).asNative;

	const context = {
		content: fs.readFileSync(fileAbsPath, 'utf-8').toString(),
		filePath: prjRelPath,
		extraArtifacts: {},
		log: new PluginLogger(),
	};

	return runLoaders(loaders, 0, context)
		.then(() => writeLoadersResult(srcPkg, destPkg, context))
		.then(() => report.rulesRun(prjRelPath, context.log));
}

/**
 * Run rule loaders contained in an array starting at given index.
 * @param {Array<object>} loaders
 * @param {number} firstLoaderIndex
 * @param {object} context the context object to pass to loaders
 * @return {Promise}
 */
function runLoaders(loaders, firstLoaderIndex, context) {
	if (firstLoaderIndex >= loaders.length) {
		return Promise.resolve(context.content);
	}

	const loader = loaders[firstLoaderIndex];

	let result;

	try {
		result = loader.exec(context, loader.options);
	} catch (err) {
		err.message = `Loader '${loader.use}' failed: ${err.message}`;
		throw err;
	}

	return Promise.resolve(result).then(content => {
		if (content !== undefined) {
			context = Object.assign(context, {content});
		}

		return runLoaders(loaders, firstLoaderIndex + 1, context);
	});
}

/**
 *
 * @param {PkgDesc} srcPkg
 * @param {PkgDesc} destPkg
 * @param {object} context
 */
function writeLoadersResult(srcPkg, destPkg, context) {
	if (context.content != undefined) {
		writeRuleFile(
			destPkg,
			srcPkg.dir.relative(project.dir.join(context.filePath)).asNative,
			context.content
		);
	}

	Object.entries(context.extraArtifacts).forEach(
		([extraPrjRelPath, content]) => {
			if (content == undefined) {
				return;
			}

			writeRuleFile(
				destPkg,
				srcPkg.dir.relative(project.dir.join(extraPrjRelPath)).asNative,
				content
			);

			context.log.info(
				'liferay-npm-bundler',
				`Rules generated extra artifact: ${extraPrjRelPath}`
			);
		}
	);
}

/**
 * Write a file generated by a rule for a given destination package.
 * @param {PkgDesc} destPkg
 * @param {string} pkgRelPath
 * @param {string} content
 */
function writeRuleFile(destPkg, pkgRelPath, content) {
	if (destPkg.isRoot) {
		pkgRelPath = stripSourceDir(pkgRelPath);
	}

	const fileAbsPath = project.dir.join(destPkg.dir, pkgRelPath).asNative;

	fs.ensureDirSync(path.dirname(fileAbsPath));
	fs.writeFileSync(fileAbsPath, content);
}

/**
 * String configured source prefixes from package file path.
 * @param {string} pkgRelPath
 */
export function stripSourceDir(pkgRelPath) {
	pkgRelPath = `.${path.sep}${pkgRelPath}`;

	for (const sourcePath of project.sources.asNative) {
		const prefixPath = `${sourcePath}${path.sep}`;

		if (pkgRelPath.startsWith(prefixPath)) {
			return pkgRelPath.substring(prefixPath.length);
		}
	}

	return pkgRelPath;
}
