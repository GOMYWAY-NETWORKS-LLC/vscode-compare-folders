import { commands, Uri, extensions, window } from 'vscode';
import { compare, fileCompareHandlers } from 'dir-compare';
import { openFolder } from './openFolder';
import * as path from 'path';
import { DiffViewTitle, getConfiguration } from './configuration';
import { pathContext } from '../context/path';
import { compareIgnoredExtension, compareName, validate } from './ignoreExtensionTools';
import { CompreOptions } from '../types';
import { log } from './logger';
import { showErrorMessage } from '../utils/ui';

const diffMergeExtension = extensions.getExtension('moshfeu.diff-merge');

export async function chooseFoldersAndCompare(path?: string) {
  const folder1Path: string = path || (await openFolder());
  const folder2Path = await openFolder();

  if (!folder1Path || !folder2Path) {
    return;
  }

  pathContext.setPaths(folder1Path, folder2Path);
  return compareFolders();
}

function getTitle(
  path: string,
  relativePath: string,
  titleFormat: DiffViewTitle = getConfiguration('diffViewTitle')
): string {
  switch (titleFormat) {
    case 'name only':
      return relativePath;
    case 'compared path':
      return `${path} ↔ ${relativePath}`;
    default:
      return '';
  }
}

export async function showDiffs([file1, file2]: [string, string], relativePath: string) {
  if (getConfiguration('useDiffMerge')) {
    if (diffMergeExtension) {
      commands.executeCommand('diffMerge.compareSelected', Uri.file(file1), [
        Uri.file(file1),
        Uri.file(file2),
      ]);
    } else {
      window.showErrorMessage(
        'In order to use "Diff & Merge" extension you should install / enable it'
      );
    }
    return;
  } else {
    commands.executeCommand(
      'vscode.diff',
      Uri.file(file1),
      Uri.file(file2),
      getTitle(file1, relativePath, compareIgnoredExtension(file1, file2) ? 'full path' : undefined)
    );
  }
}

export async function showFile(file: string) {
  commands.executeCommand('vscode.open', Uri.file(file));
}

function getOptions() {
  const {
    compareContent,
    excludeFilter,
    includeFilter,
    ignoreFileNameCase,
    ignoreExtension,
    ignoreWhiteSpaces,
    ignoreAllWhiteSpaces,
    ignoreEmptyLines,
    ignoreLineEnding,
  } = getConfiguration(
    'compareContent',
    'excludeFilter',
    'includeFilter',
    'ignoreFileNameCase',
    'ignoreExtension',
    'ignoreWhiteSpaces',
    'ignoreAllWhiteSpaces',
    'ignoreEmptyLines',
    'ignoreLineEnding',
  );

  const options: CompreOptions = {
    compareContent,
    excludeFilter: excludeFilter ? excludeFilter.join(',') : undefined,
    includeFilter: includeFilter ? includeFilter.join(',') : undefined,
    ignoreCase: ignoreFileNameCase,
    ignoreExtension,
    ignoreWhiteSpaces,
    ignoreAllWhiteSpaces,
    ignoreEmptyLines,
    ignoreLineEnding,
    compareFileAsync: fileCompareHandlers.lineBasedFileCompare.compareAsync,
    compareNameHandler: (ignoreExtension && compareName) || undefined,
  };
  return options;
}

export async function compareFolders(): Promise<CompareResult> {
  const emptyResponse = () => Promise.resolve(new CompareResult([], [], [], [], '', ''));
  try {
    if (!validate()) {
      return emptyResponse();
    }
    const [folder1Path, folder2Path] = pathContext.getPaths();
    const showIdentical = getConfiguration('showIdentical');
    const options = getOptions();
    // compare folders by contents
    const concatenatedOptions = { compareContent: true, ...options };
    // do the compare
    const res = await compare(folder1Path, folder2Path, concatenatedOptions);

    // get the diffs
    const { diffSet = [] } = res;

    // diffSet contains all the files and filter only the not equals files and map them to pairs of Uris
    const distinct = diffSet
      .filter((diff) => diff.state === 'distinct')
      .map((diff) => [path.join(diff.path1!, diff.name1!), path.join(diff.path2!, diff.name2!)]);

    // readable 👍 performance 👎
    const left = diffSet
      .filter((diff) => diff.state === 'left' && diff.type1 === 'file')
      .map((diff) => [path.join(diff.path1!, diff.name1!)]);

    const right = diffSet
      .filter((diff) => diff.state === 'right' && diff.type2 === 'file')
      .map((diff) => [path.join(diff.path2!, diff.name2!)]);

    const identicals = showIdentical
      ? diffSet
          .filter((diff) => diff.state === 'equal' && diff.type1 === 'file')
          .map((diff) => [path.join(diff.path1!, diff.name1!)])
      : [];

    return new CompareResult(distinct, left, right, identicals, folder1Path, folder2Path);
  } catch (error) {
    log('error while comparing', error);
    showErrorMessage('Oops, something went wrong while comparing', error);
    return emptyResponse();
  }
}

export class CompareResult {
  constructor(
    public distinct: string[][],
    public left: string[][],
    public right: string[][],
    public identicals: string[][],
    public leftPath: string,
    public rightPath: string
  ) {
    //
  }

  hasResult() {
    return this.distinct.length || this.left.length || this.right.length;
  }
}
