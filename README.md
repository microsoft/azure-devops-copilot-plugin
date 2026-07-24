# Azure DevOps Copilot Plugin

This repository packages an Azure DevOps plugin for GitHub Copilot CLI. It brings Azure DevOps context and workflows into Copilot, including remote detection, authentication, work-item queries, repository discovery, and pull-request operations.

> [!WARNING]
> This is a preview release. It is not supported for production workloads and may change without notice.

## Features

- Detects Azure DevOps Git remotes from the active workspace.
- Uses AzureAuth to acquire Azure DevOps access tokens without storing them in the repository.
- Queries work items with WIQL and opens individual work items.
- Lists repositories and finds the pull request for the current branch.
- Creates pull requests and attaches Azure DevOps pull-request artifacts to work items.
- Provides an Azure DevOps canvas as an interactive interface for these workflows.

## Installation

### GitHub Copilot App

1. Open the Copilot App command palette and choose **Install extension**.
2. Enter `https://github.com/microsoft/azure-devops-copilot-plugin/tree/main/.github/extensions/azure-devops`.
3. Choose the **User** scope to make the plugin available in all of your projects, or choose the **Project** scope to add it only to the current repository.
4. Open a Copilot session and select the **Azure DevOps** canvas when you need an interactive Azure DevOps view.

### From this repository

The plugin is included at `.github/extensions/azure-devops/extension.mjs`. GitHub Copilot CLI discovers project extensions from that directory when it opens a session in this repository.

## Requirements

- GitHub Copilot CLI with canvas support.
- Git configured with an Azure DevOps remote in the workspace that the canvas manages.
- AzureAuth installed by the host environment. On Windows, the canvas searches `%LOCALAPPDATA%\Programs\AzureAuth`; on other platforms, it searches `~/.azureauth`.

## Usage

Use the plugin's Azure DevOps capabilities from Copilot for remote-aware work-item, repository, and pull-request workflows. Open the **Azure DevOps** canvas when an interactive view is useful, then sign in with AzureAuth if prompted. The canvas reads its organization, project, and repository from the detected Git remote.

## Security

The plugin keeps an AzureAuth access token only in process memory and does not write credentials to the repository.
