# Epoch Time Comments

Github action that will post comments on a PR converting numbers found in the commits to their human readable date equivalent, assuming the number is an epoch timestamp.

## Usage

1. Create a new workflow by adding `.github/workflows/epoch-time-converter.yml` to your project.
2. In the `epoch-time-converter.yml` add the details of your job, for example:

```yml
name: Epoch Time Commenter
on: pull_request
jobs:
  add-epoch-time-comments:
    permissions:
      # Required to be able to write comments on Pull Requests
      pull-requests: write
      # Required to be able to read commit contents
      contents: read
    runs-on: ubuntu-latest
    steps:
      - uses: Duinhil/epoch-time-comments@1.0
        with:
          # Will comment on any number found in a commit greater than the minEpoch specified
          minEpoch: 946684800
```
