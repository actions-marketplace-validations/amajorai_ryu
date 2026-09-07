"use client";

import { Input } from "@ryu/ui/components/input";
import { cn } from "@ryu/ui/lib/utils";
import { Search } from "lucide-react";
import type { Route } from "next";
import Image from "next/image";
import Link, { useLinkStatus } from "next/link";
import { useEffect, useMemo, useState } from "react";

/**
 * Block-local author shape. The live app's Notion `Author` type is a structural
 * superset, so it satisfies this without importing app-local types into the block.
 */
export interface BlogAuthorData {
	avatar?: string;
	name: string;
	pageId?: string;
	slug: string;
}

/**
 * Block-local post shape, the subset of fields the presentational blog layer
 * needs. The live app's Notion `BlogPost` (which also carries `blocks`, status,
 * etc.) satisfies it structurally.
 */
export interface BlogPostData {
	authors?: BlogAuthorData[];
	banner?: string;
	content: string;
	date: string;
	id: string;
	pinned?: boolean;
	slug: string;
	tag?: string;
	title: string;
}

const AVATAR_SIZES = {
	small: { width: 20, height: 20, className: "h-5 w-5" },
	medium: { width: 24, height: 24, className: "h-6 w-6" },
	large: { width: 96, height: 96, className: "h-24 w-24" },
} as const;

function LinkPendingIndicator({ className }: { className: string }) {
	const { pending } = useLinkStatus();

	return (
		<span
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute size-2 rounded-full bg-primary opacity-0 transition-opacity",
				pending && "animate-pulse opacity-100",
				className
			)}
		/>
	);
}

/** Inline author avatars + names, presentational. */
export function BlogAuthor({
	authors,
	avatarSize = "small",
	className = "",
}: {
	authors?: BlogAuthorData[];
	avatarSize?: "small" | "medium" | "large";
	className?: string;
}) {
	const size = AVATAR_SIZES[avatarSize];

	if (!authors || authors.length === 0) {
		return null;
	}

	return (
		<div className={`flex items-center gap-2 ${className}`}>
			{authors.map((author, index) => (
				<span className="flex items-center gap-2" key={author.slug}>
					<Link
						className="relative flex items-center gap-2 transition-colors hover:text-foreground"
						href={`/blog/author/${author.slug}`}
					>
						<LinkPendingIndicator className="-top-0.5 -right-1" />
						{author.avatar && (
							<Image
								alt={author.name}
								className={`${size.className} rounded-full object-cover`}
								height={size.height}
								src={
									author.pageId
										? `/api/notion-image?pageId=${author.pageId}&prop=avatar`
										: author.avatar
								}
								unoptimized
								width={size.width}
							/>
						)}
						<span>{author.name}</span>
					</Link>
					{index < authors.length - 1 && <span>,</span>}
				</span>
			))}
		</div>
	);
}

export const BLOG_TAGS = [
	{ label: "All", value: undefined },
	{ label: "Product", value: "Product" },
	{ label: "Company", value: "Company" },
	{ label: "Guides", value: "Guides" },
	{ label: "Engineering", value: "Engineering" },
	{ label: "Community", value: "Community" },
	{ label: "Research", value: "Research" },
];

/** Tag filter chips, presentational client links. */
export function BlogTags({
	activeTag,
	authorFilter,
}: {
	activeTag?: string;
	authorFilter?: string;
}) {
	const baseUrl = authorFilter ? `/blog/author/${authorFilter}` : "/blog";

	return (
		<div className="flex flex-wrap gap-2">
			{BLOG_TAGS.map((tag) => {
				const isActive = tag.value === activeTag || !(tag.value || activeTag);
				const url = tag.value
					? `${baseUrl}?tag=${encodeURIComponent(tag.value)}`
					: baseUrl;

				return (
					<Link
						className={cn(
							"relative rounded-full px-4 py-2 font-medium text-sm outline-offset-4 transition-colors focus-visible:outline-2 focus-visible:outline-ring",
							isActive
								? "bg-muted text-foreground"
								: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
						)}
						href={url as Route}
						key={tag.label}
					>
						<LinkPendingIndicator className="-top-0.5 -right-0.5" />
						{tag.label}
					</Link>
				);
			})}
		</div>
	);
}

/** Debounced search input, presentational client component. */
export function SearchInput({
	onSearch,
	placeholder = "Search",
	className = "",
}: {
	onSearch: (query: string) => void;
	placeholder?: string;
	className?: string;
}) {
	const [query, setQuery] = useState("");

	useEffect(() => {
		const debounceTimer = setTimeout(() => {
			onSearch(query);
		}, 300);

		return () => clearTimeout(debounceTimer);
	}, [query, onSearch]);

	return (
		<div className={`relative ${className}`}>
			<Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				className="h-14 border-none bg-muted pl-10 text-lg shadow-none"
				onChange={(e) => setQuery(e.target.value)}
				placeholder={placeholder}
				type="search"
				value={query}
			/>
		</div>
	);
}

/** A single blog post card, presentational. */
export function BlogPostCard({ post }: { post: BlogPostData }) {
	const formattedDate = new Date(post.date).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});

	return (
		<div className="group transition-all duration-200">
			<div className="flex flex-col gap-1 pb-3">
				<Link className="relative block" href={`/blog/${post.slug}`}>
					<LinkPendingIndicator className="top-3 right-3" />
					{post.banner ? (
						<div className="mb-4 aspect-video w-full overflow-hidden rounded-md">
							<Image
								alt={post.title}
								className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
								height={337}
								src={`/api/notion-image?pageId=${post.id}&prop=banner`}
								unoptimized
								width={600}
							/>
						</div>
					) : null}
					<div className="flex flex-col gap-2">
						<h2
							className="font-heading font-medium text-xl transition-colors hover:underline hover:underline-offset-4"
							data-slot="article-title"
						>
							{post.title}
						</h2>
					</div>
				</Link>
				<div className="mb-2 flex items-center gap-2 text-muted-foreground text-sm">
					<BlogAuthor authors={post.authors} avatarSize="small" />
					{post.authors && post.authors.length > 0 && <span>&bull;</span>}
					<time dateTime={post.date}>{formattedDate}</time>
					{post.tag && (
						<>
							<span>&bull;</span>
							<span>{post.tag}</span>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

/** The searchable, pinned-aware blog post grid, presentational. */
export function BlogPostsSearch({
	posts,
	className = "",
}: {
	posts: BlogPostData[];
	className?: string;
}) {
	const [searchQuery, setSearchQuery] = useState("");

	const filteredPosts = useMemo(() => {
		if (!searchQuery.trim()) {
			return posts;
		}
		const query = searchQuery.toLowerCase();
		return posts.filter((post) => {
			const titleMatch = post.title.toLowerCase().includes(query);
			const contentMatch = post.content.toLowerCase().includes(query);
			const tagMatch = post.tag?.toLowerCase().includes(query);
			const authorMatch = post.authors?.some((author) =>
				author.name.toLowerCase().includes(query)
			);
			return titleMatch || contentMatch || tagMatch || authorMatch;
		});
	}, [posts, searchQuery]);

	const pinnedPosts = filteredPosts.filter((post) => post.pinned);
	const unpinnedPosts = filteredPosts.filter((post) => !post.pinned);

	if (posts.length === 0) {
		return (
			<div className={className}>
				<div className="py-12 text-center">
					<p className="text-muted-foreground">Nothing here yet.</p>
				</div>
			</div>
		);
	}

	return (
		<div className={className}>
			<div className="mb-8">
				<SearchInput onSearch={setSearchQuery} placeholder="Search posts" />
			</div>
			{filteredPosts.length === 0 ? (
				<div className="py-12 text-center">
					<p className="text-muted-foreground">
						No blog posts found matching "{searchQuery}".
					</p>
				</div>
			) : (
				<div className="space-y-12">
					{pinnedPosts.length > 0 && (
						<div className="grid gap-6 md:grid-cols-2">
							{pinnedPosts.map((post) => (
								<BlogPostCard key={post.id} post={post} />
							))}
						</div>
					)}
					{unpinnedPosts.length > 0 && (
						<div className="grid grid-cols-1 gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
							{unpinnedPosts.map((post) => (
								<BlogPostCard key={post.id} post={post} />
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
