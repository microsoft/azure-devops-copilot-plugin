# Azure DevOps Copilot Canvas

This repository packages an Azure DevOps canvas for GitHub Copilot CLI. The canvas detects the Azure DevOps remote for the current workspace and provides a local UI for work items, repositories, and pull requests.

## Features

- Detects Azure DevOps Git remotes from the active workspace.
- Uses AzureAuth to acquire Azure DevOps access tokens without storing them in the repository.
- Queries work items with WIQL and opens individual work items.
- Lists repositories and finds the pull request for the current branch.
- Creates pull requests and attaches Azure DevOps pull-request artifacts to work items.

## Installation

The extension is included at `.github/extensions/azure-devops/extension.mjs`. GitHub Copilot CLI discovers project extensions from that directory when it opens a session in this repository.

## Requirements

- GitHub Copilot CLI with canvas support.
- Git configured with an Azure DevOps remote in the workspace that the canvas manages.
- AzureAuth installed by the host environment. On Windows, the canvas searches `%LOCALAPPDATA%\Programs\AzureAuth`; on other platforms, it searches `~/.azureauth`.

## Usage

Open the **Azure DevOps** canvas from Copilot, then sign in with AzureAuth if prompted. The canvas reads its organization, project, and repository from the detected Git remote. The agent can also invoke the canvas actions for work-item queries, pull-request details, repository lists, and pull-request creation.

## Security

The canvas keeps an AzureAuth access token only in process memory and does not write credentials to the repository.
