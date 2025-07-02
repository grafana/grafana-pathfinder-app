# Project Brief

This file serves as:

- Foundation document that shapes all other files
- Defines core requirements and goals
- Source of truth for project scope

## What this Project Is

We are building an app plugin to Grafana that appears as a right-hand sidebar tray in the main 
Grafana experience. The right-hand sidebar displays recommendations on helpful resources that users
can use as they learn to navigate and work with the Grafana interface.

## Core Requirements and Goals

Grafana invests substantial time and effort in developing good documentation for its products,
but at present our distribution strategy is only to "hope users Google to the right thing".
Namely, we know there are beginning users who may not know what to look for, or at which moment.

Further, in the best case, documentation is a static set of words on a website.  When users actually
dig into Grafana, they have to read in a separate window and correlate words on the page to 
what they see in the interface.  We think we can do better:

1. Documentation in product (_Use the information along side where you use it_)
2. Personalized recommendations (_Grafana should sense what you need, and give you that, not everything_)
3. Interactive documentation (_Don't just tell, show, and where possible, do it for the user_)

## Content Recommendations

The content that users see can be sensitive based on which plugins & data sources they have
available, and how far they've gotten in their Grafana learning.  As an example, we don't want to 
recommend advanced dashboard tricks when a user doesn't have a data source yet, and we also don't
want to recommend "Getting Started with Infinity" for a user that has 10 dashboards.

## Target Audience / Target User Persona

Our target audience is beginners who need to quickly get started with Grafana products and
configurations.  If you're new to Grafana or observability and need to learn a lot of concepts at once,
you're squarely in our target.  If you have experience with another o11y tool but not with Grafana, you're in.

Our target audience is **not** a deep Grafana expert who is familiar with the technology.  Such
users tend to benefit more from reference-oriented documentation, and seek to make tweaks to 
existing setups they have, more often than they set up and configure new products from scratch.
