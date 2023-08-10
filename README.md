# Obsidian Webdav File Explorer Plugin

Requirements: We often need to save some of the files specialized in each software, it is not convenient to Obsidian management. For example, compressed packages, videos, pptx documents and so on.

Solution: The plugin supports you to save files in any Webdav access support network disk or cloud storage. The plugin provides browsing and referencing of these files. The plugin will read the files within Webdav and display them in the form of a file tree. On the other hand, the plugin creates fully symmetric md file trees in the local path. In the corresponding md file you can provide a description of the file for subsequent retrieval. As shown in the figure below.
![image.png](https://red0orange-1307037246.cos.ap-guangzhou.myqcloud.com/pictures/20230810184225.png)

Usage:
1. Install and enable the plugin.
2. Set your Webdav file path at the plugin settings. Where "remote dir" is the specified root path, or empty if it is the entire root directory. Where "root folder path" is the local root directory for creating symmetric md files for each folder.

Thanks:
- [recent file](https://github.com/tgrosinger/recent-files-obsidian/blob/main/main.ts)
- [remotely-save](https://github.com/remotely-save/remotely-save/tree/master)
- [Remotely-save](https://github.com/remotely-save/remotely-save)
- [aliyundrive-webdav](https://github.com/messense/aliyundrive-webdav)