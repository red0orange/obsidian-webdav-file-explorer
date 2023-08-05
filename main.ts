import {
    App,
    TFile,
    Editor,
    MarkdownView,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    ItemView,
    WorkspaceLeaf,
    Menu,
    EditorPosition,
    EditorSuggestContext,
    EditorSuggestTriggerInfo
} from 'obsidian';

import type {
    WebdavConfig,
} from "./baseTypes";
import {
    fromWebdavItemToRemoteItem
} from "./remoteForWebdav";

import { Queue } from "@fyears/tsqueue";
import chunk from "lodash/chunk";
import flatten from "lodash/flatten";

import { AuthType, BufferLike, createClient } from "webdav/web";
export type { WebDAVClient } from "webdav/web";
import type {
    FileStat,
    WebDAVClient,
    RequestOptionsWithState,
    Response,
    ResponseDataDetailed,
} from "webdav/web";

// Remember to rename these classes and interfaces!
interface FilePath {
    path: string;
    basename: string;
}

function createFileTree(files: any[]) {
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
                // log.debug(itemsToFetchChunks);
                const subContents = [] as FileStat[];
                for (const singleChunk of itemsToFetchChunks) {
                    const r = singleChunk.map((x) => {
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
        const fileTree = createFileTree(contents);
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

const AliyunListViewType = 'aliyun-driver';

class AliyunFilesListView extends ItemView {
    private readonly plugin: AliyunDriverConnectorPlugin;
    private data: AliyunDriverData;

    public fileTreeData: any = {};

    constructor(
        leaf: WorkspaceLeaf,
        plugin: AliyunDriverConnectorPlugin,
        data: AliyunDriverData,
        fileTree: any = {},
    ) {
        super(leaf);

        this.plugin = plugin;
        this.data = data;
        this.fileTreeData = fileTree;
    }

    getViewType(): string {
        return AliyunListViewType;
    }

    getDisplayText(): string {
        return "Aliyun driver";
    }

    getIcon(): string {
        return "folder";
    }

    onload() {
        super.onload();
        this.draw();
    }

    async onOpen() {
        this.draw();
    }

    draw() {
        this.containerEl.empty();
        this.containerEl.addClass('file-explorer-view');
        this.containerEl.style.overflowY = "auto"; // 添加滚动条

        let rootUl = this.containerEl.createEl('ul', { cls: 'file-list' });
        this.constructList(this.fileTreeData, rootUl);
    }

    constructList(data: any, parentEl: any) {
        for (const key in data) {
            if (data[key].type === "directory") {
                let dirLi = parentEl.createEl('li', { cls: 'file-list-item dir' });
                let indicator = dirLi.createEl('span', { text: '>', cls: 'indicator' }); // 添加指示符
                let dirSpan = dirLi.createEl('span', { text: key, cls: 'dir-name' });

                let childUl = dirLi.createEl('ul', { cls: 'file-list' });
                childUl.style.display = 'none'; // 默认隐藏子文件夹
                dirLi.addEventListener('click', (event) => { // 点击展开或隐藏子文件夹
                    event.stopPropagation(); // 阻止事件冒泡
                    if (childUl.style.display === 'none') {
                        childUl.style.display = 'block';
                        indicator.textContent = 'v'; // 改变指示符
                    } else {
                        childUl.style.display = 'none';
                        indicator.textContent = '>'; // 改变指示符
                    }
                });

                this.constructList(data[key], childUl);
            } else if (data[key].type === "file") {
                let fileLi = parentEl.createEl('li', { cls: 'file-list-item file' });
                let fileEl = fileLi.createEl('span', { text: key, cls: 'file-name' });
                // fileEl.addEventListener('click', () => {
                //     this.app.workspace.openLinkText(key, "/", true);
                // });
            }
        }
    }

    public onHeaderMenu(menu: Menu): void {
        menu.addItem((item) => {
            item
                .setTitle('Refresh')
                .setIcon('refresh')
                .onClick(async () => {
                    await this.draw();
                });
        });
    }

    public readonly redraw = (): void => {
    }

}

interface AliyunDriverData {
    files: FilePath[];
}

const DEFAULT_DATA: AliyunDriverData = {
    files: [],
};

export default class AliyunDriverConnectorPlugin extends Plugin {
    public data: AliyunDriverData;
    public view: AliyunFilesListView;
    public webdavClient: MyWebdavClient;

    async onload() {
        await this.loadData();

        // 终端输出插件版本
        console.log('Aliyun Driver Connector: Loading plugin v' + this.manifest.version);

        this.webdavClient = new MyWebdavClient();

        // webdav client init
        const DefaultWebdavConfig: WebdavConfig = {
            address: 'http://red0orange.plus:8080',
            username: 'admin',
            password: 'admin',
            authType: 'basic',
            manualRecursive: false,
            remoteBaseDir: '2023_下半年',
        };
        this.webdavClient.init(DefaultWebdavConfig);

        // webdav client check connectivity
        console.log(this.webdavClient.checkConnectivity());
        console.log(this.webdavClient.listFromRemote("auto_1"));
        const fileTree = await this.webdavClient.listFromRemote("auto_1");
        const [uniqueMember] = Object.values(fileTree);

        // 注册 view
        this.addStyle();

        this.registerView(
            AliyunListViewType,
            (leaf) => (this.view = new AliyunFilesListView(leaf, this, this.data, uniqueMember))
        )

        // 注册打开 View 的命令
        this.addCommand({
            id: 'aliyun-driver-connector-open',
            name: 'Open Aliyun Files',
            callback: async () => {
                let [leaf] = this.app.workspace.getLeavesOfType(AliyunListViewType);
                if (!leaf) {
                    leaf = this.app.workspace.getLeftLeaf(false);
                    await leaf.setViewState({ type: AliyunListViewType });
                }

                this.app.workspace.revealLeaf(leaf);
            }
        });
        (this.app.workspace as any).registerHoverLinkSource(
            AliyunListViewType,
            {
                display: 'Aliyun Files',
                defaultMod: true,
            },
        );

        // 当 layout 准备好时，构建 view
        if (this.app.workspace.layoutReady) {
            this.initView();
        } else {
            this.registerEvent(this.app.workspace.on('layout-ready', this.initView));
        }

        // 注册设置页面
        this.addSettingTab(new AliyunDriverConnectorSettingTab(this.app, this));

        // If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
        // Using this function will automatically remove the event listener when this plugin is disabled.
        this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
            console.log('click', evt);
        });

        // When registering intervals, this function will automatically clear the interval when the plugin is disabled.
        this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
    }

    onunload() {
        (this.app.workspace as any).unregisterHoverLinkSource(AliyunListViewType);
    }

    addStyle() {
        let styleEl = document.createElement('style');
        styleEl.innerHTML = `
            .file-explorer-view {
                padding: 10px;
                font-size: 14px;
            }
            .file-explorer-view .dir-name {
                color: #2196f3;
                cursor: pointer;
                font-weight: 600;
            }
            .file-explorer-view .file-name {
                color: #333;
                cursor: pointer;
            }
            .file-explorer-view ul.file-list {
                list-style: none;
                padding-left: 20px;
            }
            .file-explorer-view ul.file-list li.file-list-item {
                margin-bottom: 5px;
            }
            .file-explorer-view ul.file-list li.file-list-item.dir:before {
                content: '📁 ';
            }
            .file-explorer-view ul.file-list li.file-list-item.file:before {
                content: '📄 ';
            }
        `;
        document.head.appendChild(styleEl);
    }

    public redraw = async (): Promise<void> => {
        // webdav client reinit
        await this.webdavClient.init(this.webdavClient.webdavConfig);

        // view 重绘
        await this.view.redraw();
    }

    private readonly initView = async (): Promise<void> => {
        let leaf: WorkspaceLeaf | undefined;
        for (leaf of this.app.workspace.getLeavesOfType(AliyunListViewType)) {
            if (leaf.view instanceof AliyunFilesListView) {
                return;
            }
            await leaf.setViewState({ type: 'empty' });
            break;
        }
        (leaf ?? this.app.workspace.getLeftLeaf(false)).setViewState({
            type: AliyunListViewType,
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

class AliyunDriverConnectorSettingTab extends PluginSettingTab {
    private readonly plugin: AliyunDriverConnectorPlugin;

    constructor(app: App, plugin: AliyunDriverConnectorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    public display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // 标题
        containerEl.createEl('h2', { text: 'Aliyun Driver Connector Settings' });
        // aliyun driver webdav 配置
        new Setting(containerEl)
            .setName('Aliyun Driver WebDAV: address')
            .setDesc('Aliyun Driver WebDAV 服务器的端口')
            .addText((text) => {
                text.inputEl.setAttr('type', 'text');
                text.inputEl.setAttr('placeholder', '127.0.0.1:5050');
                text.setValue(this.plugin.webdavClient.webdavConfig.address.toString());
                text.inputEl.onblur = (e: FocusEvent) => {
                    this.plugin.webdavClient.webdavConfig.address = (e.target as HTMLInputElement).value;
                    this.plugin.redraw();
                }
            });
        new Setting(containerEl)
            .setName('Aliyun Driver WebDAV: user')
            .setDesc('Aliyun Driver WebDAV 服务器的用户名')
            .addText((text) => {
                text.inputEl.setAttr('type', 'text');
                text.inputEl.setAttr('placeholder', 'admin');
                text.setValue(this.plugin.webdavClient.webdavConfig.username);
                text.inputEl.onblur = (e: FocusEvent) => {
                    this.plugin.webdavClient.webdavConfig.username = (e.target as HTMLInputElement).value;
                    this.plugin.redraw();
                }
            });
        new Setting(containerEl)
            .setName('Aliyun Driver WebDAV: password')
            .setDesc('Aliyun Driver WebDAV 服务器的密码')
            .addText((text) => {
                text.inputEl.setAttr('type', 'text');
                text.inputEl.setAttr('placeholder', 'admin');
                text.setValue(this.plugin.webdavClient.webdavConfig.password);
                text.inputEl.onblur = (e: FocusEvent) => {
                    this.plugin.webdavClient.webdavConfig.password = (e.target as HTMLInputElement).value;
                    this.plugin.redraw();
                }
            });

    }
}

class SampleModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.setText('Woah!');
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}