# FinalShell 静态研究与 Rust 重写规范

本目录是针对 `D:\app\finalshell` 的只读静态研究，以及一份不依赖原实现代码的 Rust 产品开发规范。

## 阅读顺序

1. [研究报告](./RESEARCH_REPORT.md)：原程序的结构、功能、运行机制、数据行为、证据和未知项。
2. [产品开发规范](./PRODUCT_SPEC.md)：产品边界、功能优先级、用户流程和验收要求。
3. [Rust 技术规范](./RUST_IMPLEMENTATION_SPEC.md)：模块、接口、数据契约、安全和测试要求。

## 证据目录

- `evidence/finalshell-jar-evidence.json`：REA 对 `finalshell.jar` 的完整静态归档证据，约 49.8 MB。
- `evidence/finalshell-launcher-evidence.json`：REA 对 Windows 启动器的静态归档证据。
- `decompiled/`：CFR 0.152 的部分静态反编译结果；主动停止全量任务，不能视为完整源码。
- `resources/`：JAR 中的文本资源，不含用户的 `conn` 数据。
- `tools/cfr-0.152.jar`：静态 JVM 反编译工具。
- 入口类 `st` 已静态检查，临时提取的 `.class` 副本已清理。

## 范围与限制

- 没有启动、调试或修改 FinalShell，没有连接远程服务器，也没有读取或复制连接凭据。
- REA 的归档分析覆盖 JAR 中央目录中的全部条目，但不等于 JVM 方法级全覆盖。
- 程序存在明显名称、字符串和反射混淆，反编译输出只作行为证据，不是可直接构建的源码。
- 规范中的安全存储、模块边界和 Rust 技术选型是重新设计的决策，不声称与原实现一致。
- 只用于用户拥有或获授权分析的软件；不要复制原程序专有代码、商标、图标或许可受限组件。

