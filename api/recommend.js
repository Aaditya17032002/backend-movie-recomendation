const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { getMusicRecommendations } = require('./music');

// Helper function to build Gemini prompt
function buildGeminiPrompt(likedMovies, preferences, alreadyRecommended = [], excludeMovies = []) {
    const page = preferences.page || 1;
    const offset = (page - 1) * 5;
    
    // Build content type filter message
    let contentTypeFilter = '';
    if (preferences.contentType === 'movies') {
        contentTypeFilter = 'Recommend ONLY movies (no TV series)';
    } else if (preferences.contentType === 'tv_series') {
        contentTypeFilter = 'Recommend ONLY TV series (no movies)';
    }

    // Build region filter message
    let regionFilter = '';
    if (preferences.region === 'hollywood') {
        regionFilter = 'Recommend ONLY Hollywood (English) content';
    } else if (preferences.region === 'bollywood') {
        regionFilter = 'Recommend ONLY Bollywood (Hindi) content';
    }

    return `You are a movie and TV series recommendation expert. Based on the following information, recommend 5 titles that would match the user's taste. Return ONLY a valid JSON object with no additional text or formatting.

Input:
Liked Movies/Shows: ${likedMovies.join(', ')}
Preferences:
- Genres: ${preferences.genres.join(', ')}
- Mood: ${preferences.mood}
- Page: ${page}
${contentTypeFilter ? `- Content Type: ${contentTypeFilter}` : ''}
${regionFilter ? `- Region: ${regionFilter}` : ''}
${alreadyRecommended.length ? `Do NOT recommend any of these: ${alreadyRecommended.join(', ')}` : ''}
${excludeMovies && excludeMovies.length ? `Do NOT recommend any of these (already watched or in watchlist): ${excludeMovies.join(', ')}` : ''}

Important Guidelines:
1. ${contentTypeFilter || 'Recommend both movies and TV series'}
2. ${regionFilter || 'Include recommendations from all languages and regions'}
3. For each page, recommend DIFFERENT titles that haven't been recommended before
4. If this is page ${page}, recommend titles ${offset + 1} to ${offset + 5} in your list of recommendations
5. For each recommendation, include the release year (YYYY) and specify if it is a movie or tv_series.

Return a JSON object in this exact format:
{
    "recommendations": [
        {
            "title": "Title",
            "type": "movie or tv_series",
            "year": "YYYY",
            "reasoning": "Why this title matches the user's taste",
            "genres": ["genre1", "genre2"],
            "mood": "mood of the title"
        }
    ]
}

Important: Return ONLY the JSON object, no additional text, no markdown formatting, no backticks.`;
}

// Helper function to fetch TMDB data
async function fetchTMDBData(movieTitle, preferences = {}, year = null, type = null) {
    try {
        const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
        // Determine which endpoints to search based on content type or explicit type
        const searchEndpoints = [];
        if (type === 'movie' || (!type && (!preferences.contentType || preferences.contentType === 'movies'))) {
            searchEndpoints.push('movie');
        }
        if (type === 'tv' || (!type && (!preferences.contentType || preferences.contentType === 'tv_series'))) {
            searchEndpoints.push('tv');
        }
        // Search for content based on preferences
        const searchPromises = searchEndpoints.map(endpoint =>
            axios.get(`${TMDB_BASE_URL}/search/${endpoint}`, {
                params: {
                    api_key: process.env.TMDB_API_KEY,
                    query: movieTitle,
                    include_adult: false,
                    language: 'en-US',
                    year: endpoint === 'movie' && year ? year : undefined,
                    first_air_date_year: endpoint === 'tv' && year ? year : undefined
                }
            })
        );
        const responses = await Promise.all(searchPromises);
        // Combine and filter results
        let allResults = [];
        responses.forEach((response, index) => {
            const mediaType = searchEndpoints[index];
            const results = response.data.results.map(r => ({
                ...r,
                media_type: mediaType,
                original_language: r.original_language,
                original_title: mediaType === 'movie' ? (r.original_title || r.title) : (r.original_name || r.name)
            }));
            allResults = [...allResults, ...results];
        });
        // Filter by region if specified
        if (preferences.region) {
            allResults = allResults.filter(result => {
                if (preferences.region === 'hollywood') {
                    return result.original_language === 'en';
                } else if (preferences.region === 'bollywood') {
                    return result.original_language === 'hi';
                }
                return true;
            });
        }
        // Best match: match by title (case-insensitive, ignore punctuation), year, and type
        function normalize(str) {
            return str ? str.toLowerCase().replace(/[^a-z0-9]/gi, '') : '';
        }
        let bestMatch = null;
        if (allResults.length) {
            // Try to match by normalized title and year
            bestMatch = allResults.find(r =>
                normalize(r.title || r.name) === normalize(movieTitle) &&
                (
                    (year && ((r.release_date && r.release_date.startsWith(year)) || (r.first_air_date && r.first_air_date.startsWith(year)))) ||
                    !year
                )
            );
            // If not found, try by normalized title only
            if (!bestMatch) {
                bestMatch = allResults.find(r => normalize(r.title || r.name) === normalize(movieTitle));
            }
            // If still not found, fallback to most popular
            if (!bestMatch) {
                bestMatch = allResults[0];
            }
        }
        if (!bestMatch) {
            console.log('No results found for:', movieTitle);
            return null;
        }
        const detailsEndpoint = bestMatch.media_type;
        const detailsResponse = await axios.get(`${TMDB_BASE_URL}/${detailsEndpoint}/${bestMatch.id}`, {
            params: {
                api_key: process.env.TMDB_API_KEY,
                append_to_response: 'credits',
                language: 'en-US'
            }
        });
        return {
            tmdb_id: bestMatch.id,
            media_type: bestMatch.media_type,
            original_language: bestMatch.original_language,
            original_title: bestMatch.original_title,
            poster_path: detailsResponse.data.poster_path,
            backdrop_path: detailsResponse.data.backdrop_path,
            release_date: bestMatch.media_type === 'movie' ? detailsResponse.data.release_date : detailsResponse.data.first_air_date,
            runtime: bestMatch.media_type === 'movie' ? detailsResponse.data.runtime : detailsResponse.data.episode_run_time?.[0],
            genres: detailsResponse.data.genres.map(g => g.name),
            cast: detailsResponse.data.credits.cast.slice(0, 5).map(actor => ({
                name: actor.name,
                character: actor.character
            })),
            crew: detailsResponse.data.credits.crew.slice(0, 5).map(member => ({
                name: member.name,
                job: member.job
            }))
        };
    } catch (error) {
        console.error('TMDB API Error:', error);
        return null;
    }
}

// Helper function to fetch OMDb data
async function fetchOMDBData(movieTitle) {
    try {
        const OMDB_BASE_URL = 'http://www.omdbapi.com/';
        const response = await axios.get(OMDB_BASE_URL, {
            params: {
                apikey: process.env.OMDB_API_KEY,
                t: movieTitle
            }
        });
        if (response.data.Response === 'False') {
            return null;
        }
        return {
            imdb_rating: response.data.imdbRating,
            plot: response.data.Plot,
            awards: response.data.Awards,
            box_office: response.data.BoxOffice
        };
    } catch (error) {
        console.error('OMDb API Error:', error);
        return null;
    }
}

async function handleRecommendations(req, res) {
    try {
        const { likedMovies, preferences, alreadyRecommended, excludeMovies } = req.body;
        
        // If content type is music, use music recommendations
        if (preferences.contentType === 'music') {
            return await getMusicRecommendations(req, res);
        }
        
        // Existing movie/TV series recommendation logic
        if (!likedMovies || !preferences) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // Validate content type and region preferences
        if (preferences.contentType && !['movies', 'tv_series'].includes(preferences.contentType)) {
            return res.status(400).json({ error: 'Invalid content type preference' });
        }
        if (preferences.region && !['hollywood', 'bollywood'].includes(preferences.region)) {
            return res.status(400).json({ error: 'Invalid region preference' });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = buildGeminiPrompt(likedMovies, preferences, alreadyRecommended, excludeMovies);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const responseText = response.text().trim();
        const cleanResponse = responseText.replace(/```json\n?|\n?```/g, '').trim();
        let recommendations;
        try {
            recommendations = JSON.parse(cleanResponse).recommendations;
        } catch (parseError) {
            console.error('Failed to parse Gemini response:', cleanResponse);
            throw new Error('Failed to parse AI response');
        }

        // Filter out any recommendations that are in excludeMovies (case-insensitive)
        const excludeSet = new Set((excludeMovies || []).map(t => t.toLowerCase().trim()));
        recommendations = recommendations.filter(rec => !excludeSet.has(rec.title.toLowerCase().trim()));

        const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';
        const enrichedRecommendations = await Promise.all(
            recommendations.map(async (rec) => {
                // Use year and type if available for better matching
                const tmdbData = await fetchTMDBData(
                    rec.title,
                    preferences,
                    rec.year || null,
                    rec.type === 'tv_series' ? 'tv' : (rec.type === 'movie' ? 'movie' : null)
                );
                const omdbData = await fetchOMDBData(rec.title);
                // Fallback poster image
                const fallbackPoster = 'https://via.placeholder.com/500x750?text=No+Image';
                return {
                    ...rec,
                    tmdb_data: tmdbData,
                    omdb_data: omdbData,
                    poster_url: tmdbData && tmdbData.poster_path ? `${TMDB_IMAGE_BASE_URL}${tmdbData.poster_path}` : fallbackPoster,
                    backdrop_url: tmdbData && tmdbData.backdrop_path ? `${TMDB_IMAGE_BASE_URL}${tmdbData.backdrop_path}` : null
                };
            })
        );
        res.status(200).json({ recommendations: enrichedRecommendations });
    } catch (error) {
        console.error('Recommendation Error:', error);
        res.status(500).json({
            error: 'Failed to generate recommendations',
            details: error.message
        });
    }
}

module.exports = handleRecommendations; 