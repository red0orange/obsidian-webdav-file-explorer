// obsidian api
import {
    App,
    Modal,
    Plugin,
    PluginSettingTab,
    Setting,
    Notice,
    ItemView,
    WorkspaceLeaf,
    Menu,
    TFile
} from 'obsidian';

// webdav api
import { AuthType, createClient } from "webdav/web";
export type { WebDAVClient } from "webdav/web";
import type {
    FileStat,
    WebDAVClient,
} from "webdav/web";

import type {
    WebdavConfig,
} from "./baseTypes";
import {
    fromWebdavItemToRemoteItem
} from "./remoteForWebdav";

// lodash api
import chunk from "lodash/chunk";
import flatten from "lodash/flatten";

// other api
import * as path from 'path';
import { Queue } from "@fyears/tsqueue";

import * as fs from 'fs';
import * as pathModule from 'path';
import { test } from 'xregexp';


interface FilePath {
  path: string;
  basename: string;
}


function createFileTreeFromWebdav(files: any[]) {
    // 创建树的根
    const fileTree: any = {};

    // 为每个文件和目录在树中创建位置
    for (const file of files) {
        const parts = file.filename.split('/');
        let currentLocation = fileTree;

        // 跳过空字符串（第一个斜杠之前的部分）
        for (let i = 1; i < parts.length; i++) {
            const part = parts[i];

            // 如果我们还没有到达文件名，则创建或导航到目录
            if (i < parts.length - 1) {
                if (!currentLocation[part]) {
                    currentLocation[part] = {};
                }

                currentLocation = currentLocation[part];
            }

            // 如果我们到达了文件名，则添加文件
            else {
                currentLocation[part] = file;
            }
        }
    }

    return fileTree;
}


class MyWebdavClient {
    client: WebDAVClient
    webdavConfig: WebdavConfig

    flag: boolean = false;

    constructor(
    ) {
    }

    init = async (webdavConfig: WebdavConfig) => {
        this.webdavConfig = webdavConfig;
        const headers = {
            "Cache-Control": "no-cache",
        };
        // console.log(webdavConfig);
        this.client = createClient(webdavConfig.address, {
            username: webdavConfig.username,
            password: webdavConfig.password,
            headers: headers,
            authType: AuthType.Password,
        });
        this.flag = true;
    }

    listFromRemote = async (
        depth: string,
    ) => {  // 函数：获取远程文件夹的文件列表
        const remotePath = this.webdavConfig.remoteBaseDir || '/';

        let contents = [] as FileStat[];
        if (depth === "auto_1" || depth === "manual_1") {
        // if (true) {
            // the remote doesn't support infinity propfind,
            // we need to do a bfs here
            const q = new Queue([`/${remotePath}`]);
            const CHUNK_SIZE = 10;
            while (q.length > 0) {
                const itemsToFetch = [];
                while (q.length > 0) {
                    itemsToFetch.push(q.pop());
                }
                const itemsToFetchChunks = chunk(itemsToFetch, CHUNK_SIZE);
                // console.log(itemsToFetchChunks);
                const subContents = [] as FileStat[];
                for (const singleChunk of itemsToFetchChunks) {
                    const r = singleChunk.map((x: any) => {
                        return this.client.getDirectoryContents(x, {
                            deep: false,
                            details: false /* no need for verbose details here */,
                            // TODO: to support .obsidian,
                            // we need to load all files including dot,
                            // anyway to reduce the resources?
                            // glob: "/**" /* avoid dot files by using glob */,
                        }) as Promise<FileStat[]>;
                    });
                    const r2 = flatten(await Promise.all(r));
                    subContents.push(...r2);
                }
                for (let i = 0; i < subContents.length; ++i) {
                    const f = subContents[i];
                    contents.push(f);
                    if (f.type === "directory") {
                        q.push(f.filename);
                    }
                }
            }
        } else {
            // the remote supports infinity propfind
            contents = (await this.client.getDirectoryContents(
                `/${remotePath}`,
                {
                    deep: true,
                    details: false /* no need for verbose details here */,
                    // TODO: to support .obsidian,
                    // we need to load all files including dot,
                    // anyway to reduce the resources?
                    // glob: "/**" /* avoid dot files by using glob */,
                }
            )) as FileStat[];
        }
        const fileTree = createFileTreeFromWebdav(contents);
        console.log(fileTree);
        return fileTree;
    }

    checkConnectivity = async (callbackFunc?: any) => { // 函数：检查是否能够连接到 WebDAV 服务器
        if (!this.flag) {
            console.log("Error: webdav client is not initialized!");
            return;
        }
        // 检查 address
        if (
            !(
                this.webdavConfig.address.startsWith("http://") ||
                this.webdavConfig.address.startsWith("https://")
            )
        ) {
            const err = "Error: the url should start with http(s):// but it does not!";
            console.log(err);
            if (callbackFunc !== undefined) {
                callbackFunc(err);
            }
            return false;
        }

        // 检查连接性
        try {
            const remotePath = this.webdavConfig.remoteBaseDir || '';
            const res = (await this.client.stat(remotePath, {
                details: false,
            })) as FileStat;
            const results = fromWebdavItemToRemoteItem(res, remotePath);
            if (results === undefined) {
                const err = "results is undefined";
                console.log(err);
                if (callbackFunc !== undefined) {
                    callbackFunc(err);
                }
                return false;
            }
            return true;
        } catch (err) {
            console.log(err);
            if (callbackFunc !== undefined) {
                callbackFunc(err);
            }
            return false;
        }
    }
}


const WebdavListViewType = 'webdav-file-explorer';


class WebdavFilesListView extends ItemView {
    private readonly plugin: WebdavFileExplorerPlugin;
    private data: WebdavFileExplorerData;

    public fileTreeData: any = {};

    constructor(
        leaf: WorkspaceLeaf,
        plugin: WebdavFileExplorerPlugin,
        data: WebdavFileExplorerData,
        fileTree: any = {},
    ) {
        super(leaf);

        this.plugin = plugin;
        this.data = data;
        this.fileTreeData = fileTree;
    }

    getViewType(): string {
        return WebdavListViewType;
    }

    getDisplayText(): string {
        return "Webdav File Explorer";
    }

    getIcon(): string {
        return "folder";
    }

    onload() {
        super.onload();
        this.redraw();
    }

    async onOpen() {
        super.onOpen();
        this.redraw();
    }

    redraw() {
        this.containerEl.empty();
        this.containerEl.addClass('file-explorer-view');
        this.containerEl.style.overflowY = "auto"; // 添加滚动条

        // // 添加搜索框
        // let searchBox = this.containerEl.createEl('input', { type: 'text', placeholder: 'Search...' });
        // searchBox.addEventListener('keyup', () => {
        //     let searchValue = searchBox.value;
        //     let filteredData = this.filterFileTree(this.fileTreeData, searchValue);
        //     rootUl.empty();  // 清空当前列表
        //     this.constructList(filteredData, rootUl);  // 根据筛选后的数据重新构造列表
        // });

        let refreshButton = this.containerEl.createEl('button', { text: 'Refresh' });
        refreshButton.addEventListener('click', async () => {
            await this.plugin.updateData();
            this.fileTreeData = this.plugin.fileTreeData;
            await this.redraw();
        });

        let rootUl = this.containerEl.createEl('ul', { cls: 'file-list' });
        this.constructList(this.fileTreeData, rootUl);
    }

    filterFileTree(data: any, searchValue: string): any {
        let filteredData: any = {};

        for (const key in data) {
            if (data[key].type === "file" && key.includes(searchValue)) {
                filteredData[key] = data[key];
            } else if (data[key].type === "directory") {
                let filteredSubdirectory = this.filterFileTree(data[key], searchValue);
                if (Object.keys(filteredSubdirectory).length > 0) {
                    filteredData[key] = filteredSubdirectory;
                }
            }
        }

        return filteredData;
    }

    getPathForKey(data: any, targetKey: string, path: string[] = []): string {
        for (const key in data) {
            if (key === targetKey) {
                return [...path, key].join('/');
            } else if (data[key].type === "directory") {
                let result = this.getPathForKey(data[key], targetKey, [...path, key]);
                if (result) return result;
            }
        }
        return null;
    }

    constructList(data: any, parentEl: any) {
        // @note 检查这里的 notes 是否正确
        const filted_keys = Object.keys(data).filter(key => (typeof data[key] === 'object') && (data[key] !== null));
        for (const key of filted_keys) {
            // console.log("Debug: " + key); // @note 检查这里的 keys 是否正确

            if (data[key].type === "directory") {
                let dirLi = parentEl.createEl('li', { cls: 'file-list-item dir' });
                let indicator = dirLi.createEl('span', { text: '\u25B6', cls: 'indicator', style: 'font-size: 0.1em;' }); // 添加指示符并且降低其大小
                let dirSpan = dirLi.createEl('span', { text: key, cls: 'dir-name' });

                dirSpan.addEventListener('contextmenu', (event: MouseEvent) => {
                    event.preventDefault();

                    new Menu(this.app)
                        .addItem((item) =>
                            item.setTitle('Copy Path').onClick(() => {
                                let path = this.getPathForKey(this.fileTreeData, key);
                                navigator.clipboard.writeText(` **[${path}]** `); // 加粗path
                            })
                        )
                        .showAtPosition({ x: event.pageX, y: event.pageY });
                });

                let childUl = dirLi.createEl('ul', { cls: 'file-list' });
                childUl.style.display = 'none'; // 默认隐藏子文件夹
                dirLi.addEventListener('click', (event: any) => { // 点击展开或隐藏子文件夹
                    event.stopPropagation(); // 阻止事件冒泡
                    if (childUl.style.display === 'none') {
                        childUl.style.display = 'block';
                        indicator.textContent = '\u25BC'; // 改变指示符为下箭头
                    } else {
                        childUl.style.display = 'none';
                        indicator.textContent = '\u25B6'; // 改变指示符为右箭头
                    }
                });

                this.constructList(data[key], childUl);
            } else if (data[key].type === "file") {
                let fileLi = parentEl.createEl('li', { cls: 'file-list-item file' });
                fileLi.addEventListener('click', (event: any) => { // 点击展开或隐藏子文件夹
                    event.stopPropagation(); // 阻止事件冒泡

                    const ori_webdav_path = data[key].filename;
                    const new_obsdiian_path_name = ori_webdav_path.replace(/^\/[^\/]+/, this.plugin.data.rootFolderPath) + ".md"
                    const new_obsdiian_path: FilePath = {
                        path: new_obsdiian_path_name,
                        basename: path.basename(new_obsdiian_path_name)
                    }
                    this.focusFile(new_obsdiian_path, event.ctrlKey || event.metaKey);
                });

                let fileEl = fileLi.createEl('span', { text: key, cls: 'file-name' });

                // 添加右键菜单
                fileEl.addEventListener('contextmenu', (event: MouseEvent) => {
                    event.preventDefault();

                    new Menu(this.app)
                        .addItem((item) =>
                            item.setTitle('Copy Path').onClick(() => {
                                let path = this.getPathForKey(this.fileTreeData, key);
                                navigator.clipboard.writeText(` **[${path}]** `); // 加粗path
                            })
                        )
                        .showAtPosition({ x: event.pageX, y: event.pageY });
                });
            }
        }
    }

    /**
     * Open the provided file in the most recent leaf.
     *
     * @param shouldSplit Whether the file should be opened in a new split, or in
     * the most recent split. If the most recent split is pinned, this is set to
     * true.
     */
    private readonly focusFile = (file: FilePath, shouldSplit = false): void => {
        const targetFile = this.app.vault
        .getFiles()
        .find((f) => f.path === file.path);

        if (targetFile) {
            let leaf = this.app.workspace.getMostRecentLeaf();
            if (leaf) {
                const createLeaf = shouldSplit || leaf.getViewState().pinned;
                if (createLeaf) {
                    leaf = this.app.workspace.getLeaf('tab');
                }
                leaf.openFile(targetFile);
            }
        } else {
            new Notice('Cannot find a file with that name');
        }
    };
}

interface WebdavFileExplorerData {
    rootFolderPath: string;
    webdavConfig: WebdavConfig;
}

const DEFAULT_DATA: WebdavFileExplorerData = {
    rootFolderPath: '0_Webdav',
    webdavConfig: {
        address: 'http://127.0.0.1:8080',
        username: 'admin',
        password: 'admin',
        authType: 'basic',
        manualRecursive: false,
        remoteBaseDir: 'obsidian',
    },
};

export default class WebdavFileExplorerPlugin extends Plugin {
    public data: WebdavFileExplorerData = DEFAULT_DATA;
    public view: WebdavFilesListView;
    public webdavClient: MyWebdavClient;
    
    public fileTreeData: any;

    async onload() {
        await this.loadData();

        // 终端输出插件版本
        console.log('Webdav File Explorer: Loading plugin v' + this.manifest.version);

        this.webdavClient = new MyWebdavClient();

        // 初始化
        try {
            // some code that might throw different errors
            await this.updateData();
        } catch (error) {
            console.error("Data not ready.", error);
        }

        this.registerView(
            WebdavListViewType,
            (leaf) => (this.view = new WebdavFilesListView(leaf, this, this.data, this.fileTreeData))
        )

        // 注册打开 View 的命令
        this.addCommand({
            id: 'webdav-file-explorer-open',
            name: 'Open Webdav File Explorer',
            callback: async () => {
                let [leaf] = this.app.workspace.getLeavesOfType(WebdavListViewType);
                if (!leaf) {
                    leaf = this.app.workspace.getLeftLeaf(false);
                    await leaf.setViewState({ type: WebdavListViewType });
                }

                this.app.workspace.revealLeaf(leaf);
            }
        });
        (this.app.workspace as any).registerHoverLinkSource(
            WebdavListViewType,
            {
                display: 'Webdav File Explorer',
                defaultMod: true,
            },
        );

        // 当 layout 准备好时，构建 view
        this.app.workspace.onLayoutReady(() => {
            this.initView();
        });

        // 注册设置页面
        this.addSettingTab(new WebdavFileExplorerSettingTab(this.app, this));
    }

    onunload() {
        (this.app.workspace as any).unregisterHoverLinkSource(WebdavListViewType);
    }

    async redraw() {
        try {
            this.updateData();
            this.view.fileTreeData = this.fileTreeData;
            this.view.redraw();
        } catch (err) {
            console.log(err);
        }
    }

    async createFileTreeInFolder(folderPath: string) {
        // 获取所有文件
        const allFiles = this.app.vault.getFiles();

        // 筛选出指定文件夹下的所有文件
        const filesInFolder = allFiles.filter(file => file.path.startsWith(folderPath));

        // 创建树的根
        const fileTree: any = {};

        // 为每个文件和目录在树中创建位置
        for (const file of filesInFolder) {
            const parts = file.path.split('/');
            let currentLocation = fileTree;

            // 跳过空字符串（第一个斜杠之前的部分）
            for (let i = 1; i < parts.length; i++) {
                const part = parts[i];

                // 如果我们还没有到达文件名，则创建或导航到目录
                if (i < parts.length - 1) {
                    if (!currentLocation[part]) {
                        currentLocation[part] = {};
                    }

                    currentLocation = currentLocation[part];
                }

                // 如果我们到达了文件名，则添加文件
                else {
                    currentLocation[part] = file;
                }
            }
        }

        return fileTree;
    }

    // This function parses the file tree and creates .md files for each file
    async createFileStructure(rootPath: string, fileTree: any, path: string, vault: any) {
        console.log("Creating file structure for: " + path);
        // @note 检查这里的 fileTree 是否正确
        // @note 过滤掉属性值，剩下的只有文件夹或文件
        const filted_keys = Object.keys(fileTree).filter(key => (typeof fileTree[key] === 'object') && (fileTree[key] !== null));
        for (const key of filted_keys) {
            const item = fileTree[key];
            if (item.type === "directory") {
                console.log("Creating directory: " + path + "/" + item.basename);
                await this.createFileStructure(rootPath, item, path + "/" + item.basename, vault);
            } else if (item.type === "file") {
                const filePath = path + "/" + item.basename + ".md";
                const dirPath = pathModule.dirname(filePath);

                // Ensure the directory exists in the vault
                fs.mkdirSync(rootPath + "/" + dirPath, { recursive: true });

                const fileExists = await vault.adapter.exists(filePath);
                if (!fileExists) {
                    // console.log("Creating file: " + filePath);
                    await vault.create(filePath, '');
                }
            }
        }
    }

    public updateData = async (): Promise<void> => {
        // webdav client init
        this.webdavClient.init(this.data.webdavConfig);

        // webdav client check connectivity
        this.webdavClient.checkConnectivity();
        // console.log(this.webdavClient.listFromRemote("auto_1"));
        const fileTree = await this.webdavClient.listFromRemote("auto_1");
        const [uniqueMember] = Object.values(fileTree);
        this.fileTreeData = uniqueMember;

        // console.log(uniqueMember);

        // 创建文件结构
        const vaultPath = this.app.vault.adapter.getBasePath();
        const rootPath = vaultPath;
        this.createFileStructure(rootPath, uniqueMember, this.data.rootFolderPath, this.app.vault);
    }

    private readonly initView = async (): Promise<void> => {
        let leaf: WorkspaceLeaf | undefined;
        for (leaf of this.app.workspace.getLeavesOfType(WebdavListViewType)) {
            if (leaf.view instanceof WebdavFilesListView) {
                console.log('already exists');
                return;
            }
            await leaf.setViewState({ type: 'empty' });
            break;
        }
        (leaf ?? this.app.workspace.getLeftLeaf(false)).setViewState({
            type: WebdavListViewType,
            active: true,
        });
    }

    public async loadData(): Promise<void> {
        this.data = Object.assign(DEFAULT_DATA, await super.loadData());
    }

    public async saveData(): Promise<void> {
        await super.saveData(this.data);
    }
}

class WebdavFileExplorerSettingTab extends PluginSettingTab {
    private readonly plugin: WebdavFileExplorerPlugin;

    constructor(app: App, plugin: WebdavFileExplorerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    public display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // 标题
        containerEl.createEl('h2', { text: 'Webdav File Explorer Settings' });
        new Setting(containerEl)
            .setName('WebDAV: address')
            .setDesc('WebDAV 服务器的端口')
            .addText((text) => {
                text.inputEl.setAttr('type', 'text');
                text.inputEl.setAttr('placeholder', '127.0.0.1:5050');
                text.setValue(this.plugin.webdavClient.webdavConfig.address.toString());
                text.inputEl.onblur = (e: FocusEvent) => {
                    this.plugin.webdavClient.webdavConfig.address = (e.target as HTMLInputElement).value;

                    this.plugin.redraw();

                    this.plugin.saveData();
                }
            });
        new Setting(containerEl)
            .setName('WebDAV: user')
            .setDesc('WebDAV 服务器的用户名')
            .addText((text) => {
                text.inputEl.setAttr('type', 'text');
                text.inputEl.setAttr('placeholder', 'admin');
                text.setValue(this.plugin.webdavClient.webdavConfig.username);
                text.inputEl.onblur = (e: FocusEvent) => {
                    this.plugin.webdavClient.webdavConfig.username = (e.target as HTMLInputElement).value;

                    this.plugin.redraw();

                    this.plugin.saveData();
                }
            });
        new Setting(containerEl)
            .setName('WebDAV: password')
            .setDesc('WebDAV 服务器的密码')
            .addText((text) => {
                text.inputEl.setAttr('type', 'text');
                text.inputEl.setAttr('placeholder', 'admin');
                text.setValue(this.plugin.webdavClient.webdavConfig.password);
                text.inputEl.onblur = (e: FocusEvent) => {
                    this.plugin.webdavClient.webdavConfig.password = (e.target as HTMLInputElement).value;

                    this.plugin.redraw();

                    this.plugin.saveData();
                }
            });
        new Setting(containerEl)
            .setName('WebDAV: remote dir')
            .setDesc('WebDAV 根路径')
            .addText((text) => {
                text.inputEl.setAttr('type', 'text');
                text.inputEl.setAttr('placeholder', 'Obsidian');
                text.setValue(this.plugin.webdavClient.webdavConfig.remoteBaseDir);
                text.inputEl.onblur = (e: FocusEvent) => {
                    this.plugin.webdavClient.webdavConfig.remoteBaseDir = (e.target as HTMLInputElement).value;

                    this.plugin.redraw();

                    this.plugin.saveData();
                }
            });
        new Setting(containerEl)
            .setName('Root folder path')
            .setDesc('The path to the root folder to display in the file explorer')
            .addText((text) => {
                text.inputEl.setAttr('type', 'text');
                text.inputEl.setAttr('placeholder', '0_Webdav');
                text.setValue(this.plugin.data.rootFolderPath);
                text.inputEl.onblur = (e: FocusEvent) => {
                    this.plugin.data.rootFolderPath = (e.target as HTMLInputElement).value;

                    this.plugin.redraw();

                    this.plugin.saveData();
                }
            });
    }
}